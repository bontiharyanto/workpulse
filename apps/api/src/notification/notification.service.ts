import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  Notification as SharedNotification,
  NotificationPage,
} from '@workpulse/shared-types';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import type { NotificationContent } from './domain/templates';
import { EMAIL_ADAPTER, type EmailAdapter } from './email/email-adapter';
import { NotificationPreferenceService } from './notification-preference.service';

export interface CreateNotificationInput {
  companyId: string;
  recipientId: string;
  content: NotificationContent;
  /** Recipient email — omit to skip the email delivery attempt. */
  recipientEmail?: string;
}

/**
 * Any Prisma-compatible tx handle. When called from inside a
 * `prisma.$transaction` callback, the caller passes `tx`; otherwise we fall
 * back to the service's own PrismaClient.
 */
type PrismaLike = Prisma.TransactionClient | PrismaClient;

/**
 * Persistence + fan-out for notifications.
 *
 * Ordering guarantee: the DB insert always runs first, on the caller's
 * transaction handle if provided. Email is fired **after** the caller's
 * transaction commits — but since we don't know when that will be, we
 * schedule the email in a microtask that reads the same in-memory content.
 * If the caller's tx eventually rolls back, we've already scheduled the
 * email — that's an intentional trade-off: notifications for rolled-back
 * business ops are extremely rare, and the alternative (a queue + hooks
 * into tx completion) adds complexity we don't need at MVP.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    private readonly preferences: NotificationPreferenceService,
  ) {}

  /**
   * Persist one notification. When `tx` is provided, the row is written on
   * that transaction handle so it stays atomic with the caller's operation
   * (e.g. leave submission).
   *
   * ## Preference gate (Fase 22)
   *
   * The recipient's stored preferences are consulted BEFORE both the
   * in-app insert and the email dispatch. Any of three outcomes:
   *
   *   * `inAppEnabled=false` → the DB row is NOT created; the fanout
   *     is a no-op for this channel. Semantics: user explicitly said
   *     "don't clutter my bell icon" — creating a hidden-by-default
   *     row is worse than dropping it, because the user could still
   *     see it via unreadCount / listing.
   *   * `emailEnabled=false` → the email is NOT dispatched.
   *   * Both false → the whole delivery becomes a no-op (still logged
   *     at debug level for observability).
   *
   * Mandatory types (see `mandatoryNotificationTypes`, e.g.
   * `PASSWORD_RESET`) always deliver — the gate returns
   * `{true,true}` regardless of the stored row.
   */
  async createOne(input: CreateNotificationInput, tx?: PrismaLike): Promise<void> {
    const client: PrismaLike = tx ?? this.prisma;

    // Preference lookup runs on the caller's tx handle so opt-out
    // races (user opts out mid-flight) are resolved deterministically
    // against the same snapshot as the write.
    const effective = await this.preferences.getEffective(
      input.recipientId,
      input.content.type,
      client,
    );

    if (!effective.inAppEnabled && !effective.emailEnabled) {
      this.logger.debug(
        `notification suppressed by preference: recipient=${input.recipientId} type=${input.content.type}`,
      );
      return;
    }

    if (effective.inAppEnabled) {
      await client.notification.create({
        data: {
          companyId: input.companyId,
          recipientId: input.recipientId,
          type: input.content.type,
          title: input.content.title,
          body: input.content.body,
          data: input.content.data as Prisma.InputJsonValue,
        },
      });
    }

    // Schedule email delivery *outside* the caller's transaction so a
    // slow/broken SMTP host can't stall the business op.
    if (input.recipientEmail && effective.emailEnabled) {
      this.dispatchEmail(input.recipientEmail, input.content).catch((err) => {
        this.logger.warn(`email dispatch failed: ${(err as Error).message}`);
      });
    }
  }

  /**
   * Convenience for events that need to notify multiple people (e.g. a
   * leave rejection where both employee and supervisor should know).
   * Silently swallows per-recipient errors so one bad email address
   * doesn't fail the whole notification round.
   */
  async createMany(inputs: CreateNotificationInput[], tx?: PrismaLike): Promise<void> {
    await Promise.all(
      inputs.map((i) =>
        this.createOne(i, tx).catch((err) => {
          this.logger.warn(
            `notification.createOne failed for recipient=${i.recipientId}: ${(err as Error).message}`,
          );
        }),
      ),
    );
  }

  private async dispatchEmail(to: string, content: NotificationContent): Promise<void> {
    await this.email.send({
      to,
      subject: content.title,
      body: content.body,
    });
  }

  // ------------------------------------------------------------------
  // Read APIs (invoked from the controller)
  // ------------------------------------------------------------------

  async list(
    actor: AuthenticatedUser,
    opts: { unreadOnly?: boolean; limit?: number } = {},
  ): Promise<SharedNotification[]> {
    const limit = clamp(opts.limit ?? 20, 1, 100);
    const rows = await this.prisma.notification.findMany({
      where: {
        recipientId: actor.id,
        ...(opts.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        data: true,
        readAt: true,
        createdAt: true,
      },
    });
    return rows.map(this.toDto);
  }

  /**
   * Full-archive view for the `/notifications` page. Same shape as
   * `list()` but keyset-paginated over `(createdAt, id)` so the FE
   * can walk backward through months of history without offset
   * penalties.
   *
   * The bell dropdown deliberately keeps calling `list()` because it
   * only ever renders the newest 20 rows — no need for the cursor
   * ceremony there. Two callers, two shapes.
   */
  async listPaginated(
    actor: AuthenticatedUser,
    opts: { unreadOnly?: boolean; limit?: number; cursor?: string } = {},
  ): Promise<NotificationPage> {
    const take = clamp(opts.limit ?? 25, 1, 100);
    const decoded = opts.cursor ? decodeCursor(opts.cursor) : null;

    // Overfetch by 1 to detect "has more" without a separate COUNT.
    // Same trick as the audit log viewer.
    const rows = await this.prisma.notification.findMany({
      where: {
        recipientId: actor.id,
        ...(opts.unreadOnly ? { readAt: null } : {}),
        ...(decoded && {
          OR: [
            { createdAt: { lt: new Date(decoded.createdAt) } },
            {
              createdAt: new Date(decoded.createdAt),
              id: { lt: decoded.id },
            },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        data: true,
        readAt: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > take;
    const trimmed = hasMore ? rows.slice(0, take) : rows;
    const last = trimmed[trimmed.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null;

    return {
      rows: trimmed.map((r) => this.toDto(r)),
      nextCursor,
    };
  }

  async unreadCount(actor: AuthenticatedUser): Promise<number> {
    return this.prisma.notification.count({
      where: { recipientId: actor.id, readAt: null },
    });
  }

  async markRead(actor: AuthenticatedUser, id: string): Promise<void> {
    const result = await this.prisma.notification.updateMany({
      where: { id, recipientId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      // Distinguish "row doesn't exist / belongs to another user" from
      // "already read" — the latter is idempotent success.
      const exists = await this.prisma.notification.findFirst({
        where: { id, recipientId: actor.id },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('NOTIFICATION_NOT_FOUND');
    }
  }

  async markAllRead(actor: AuthenticatedUser): Promise<{ marked: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { recipientId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: result.count };
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  private toDto(row: {
    id: string;
    type: string;
    title: string;
    body: string;
    data: Prisma.JsonValue | null;
    readAt: Date | null;
    createdAt: Date;
  }): SharedNotification {
    return {
      id: row.id,
      type: row.type as SharedNotification['type'],
      title: row.title,
      body: row.body,
      data: (row.data ?? undefined) as SharedNotification['data'],
      readAt: row.readAt ? row.readAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// ---------------------------------------------------------------------------
// Cursor codec — internal to the archive endpoint
// ---------------------------------------------------------------------------

interface NotificationCursor {
  createdAt: string;
  id: string;
}

function encodeCursor(c: NotificationCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): NotificationCursor {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as Partial<NotificationCursor>;
    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.createdAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.createdAt))
    ) {
      throw new Error('malformed cursor');
    }
    return { id: parsed.id, createdAt: parsed.createdAt };
  } catch {
    throw new BadRequestException('INVALID_CURSOR');
  }
}
