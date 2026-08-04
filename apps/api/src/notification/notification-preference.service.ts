import { Injectable } from '@nestjs/common';
import type { NotificationType, Prisma, PrismaClient } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import {
  mandatoryNotificationTypes,
  resolveEffective,
  sanitizePreferenceUpdates,
  type EffectivePreference,
  type PreferenceRow,
} from './domain/preferences';

/**
 * Row shape returned to the caller. `mandatory=true` means the user
 * cannot change this pair — the FE surfaces it as a locked toggle so
 * the user isn't confused when their "off" click has no effect.
 */
export interface PreferenceListItem {
  type: NotificationType;
  emailEnabled: boolean;
  inAppEnabled: boolean;
  mandatory: boolean;
}

export interface PreferenceUpdateInput {
  type: NotificationType;
  emailEnabled: boolean;
  inAppEnabled: boolean;
}

type PrismaLike = Prisma.TransactionClient | PrismaClient;

/**
 * Notification preference persistence.
 *
 * The service exposes three operations:
 *
 *   * `listForActor` — returns one row per NotificationType from the
 *     Prisma enum, hydrated with either the stored row (if any) or
 *     the "default on" values. Mandatory types are always returned
 *     with `emailEnabled=inAppEnabled=true` and `mandatory=true`, so
 *     the FE renders them as locked-on toggles.
 *   * `upsertMany` — bulk-upsert overrides for a batch of types.
 *     Mandatory types are silently dropped (defense-in-depth over
 *     the FE's "locked toggle" affordance). Returns the fresh
 *     representation via `listForActor`.
 *   * `getEffective` — hot path used by NotificationService fanout.
 *     Single-row seek + `resolveEffective`. Never throws for missing
 *     rows; missing = defaults.
 *
 * Everything is user-scoped to `actor.id` and `actor.companyId`; there
 * is no admin lane to edit another user's preferences (that would be
 * a policy hole — HR can already deliver ad-hoc messages via email).
 */
@Injectable()
export class NotificationPreferenceService {
  /** Frozen list of all types the DB enum knows about, used by `listForActor`. */
  private static readonly ALL_TYPES: readonly NotificationType[] = [
    'LEAVE_SUBMITTED',
    'LEAVE_APPROVED_SUPERVISOR',
    'LEAVE_APPROVED_HR',
    'LEAVE_REJECTED',
    'LEAVE_CANCELLED',
    'OVERTIME_SUBMITTED',
    'OVERTIME_APPROVED',
    'OVERTIME_REJECTED',
    'OVERTIME_CANCELLED',
    'OVERTIME_COMPLETED',
    'PASSWORD_RESET',
    'ATTENDANCE_ABSENT_MARKED',
    'ATTENDANCE_CORRECTION_SUBMITTED',
    'ATTENDANCE_CORRECTION_APPROVED',
    'ATTENDANCE_CORRECTION_REJECTED',
    'TIMESHEET_SUBMITTED',
    'TIMESHEET_APPROVED_SUPERVISOR',
    'TIMESHEET_APPROVED_HR',
    'TIMESHEET_REJECTED',
    'TIMESHEET_REGENERATED',
    'TIMESHEET_SUBMIT_REMINDER',
    'TIMESHEET_APPROVAL_REMINDER',
    'TIMESHEET_REOPENED',
  ] as const;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Return every known NotificationType hydrated with the caller's
   * stored preference (or the default). One row per type, ordered by
   * the canonical list — makes the FE render deterministic.
   */
  async listForActor(actor: AuthenticatedUser): Promise<PreferenceListItem[]> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId: actor.id },
      select: { type: true, emailEnabled: true, inAppEnabled: true },
    });
    const byType = new Map<NotificationType, PreferenceRow>(
      rows.map((r) => [r.type, r]),
    );
    return NotificationPreferenceService.ALL_TYPES.map((type) => {
      const effective = resolveEffective(type, byType.get(type) ?? null);
      return {
        type,
        emailEnabled: effective.emailEnabled,
        inAppEnabled: effective.inAppEnabled,
        mandatory: mandatoryNotificationTypes.has(type),
      };
    });
  }

  /**
   * Bulk-upsert overrides. Mandatory types are silently dropped
   * (deduped by `sanitizePreferenceUpdates`). Returns the fresh
   * `listForActor` payload so the FE can trust the response as
   * the new state of the world without a follow-up GET.
   */
  async upsertMany(
    actor: AuthenticatedUser,
    updates: readonly PreferenceUpdateInput[],
  ): Promise<PreferenceListItem[]> {
    const cleaned = sanitizePreferenceUpdates(updates);
    if (cleaned.length === 0) return this.listForActor(actor);

    // Wrap in a transaction so a partial failure doesn't leave the
    // user's preferences in a half-updated state. The batch is tiny
    // (≤ |NotificationType|), so the txn holds locks briefly.
    await this.prisma.$transaction(async (tx) => {
      for (const u of cleaned) {
        await tx.notificationPreference.upsert({
          where: {
            userId_type: {
              userId: actor.id,
              type: u.type,
            },
          },
          create: {
            companyId: actor.companyId,
            userId: actor.id,
            type: u.type,
            emailEnabled: u.emailEnabled,
            inAppEnabled: u.inAppEnabled,
          },
          update: {
            emailEnabled: u.emailEnabled,
            inAppEnabled: u.inAppEnabled,
          },
        });
      }
    });

    return this.listForActor(actor);
  }

  /**
   * Fanout hot path. Called once per (recipient, type) delivery.
   * Missing row = defaults-on (via `resolveEffective`).
   *
   * The optional `tx` allows the caller to make the preference lookup
   * atomic with the notification write. This keeps a race where the
   * user opts out MID-delivery from producing a "you disabled it but
   * still got one" edge case — the in-app row and the preference
   * check see the same snapshot.
   */
  async getEffective(
    userId: string,
    type: NotificationType,
    tx?: PrismaLike,
  ): Promise<EffectivePreference> {
    const client: PrismaLike = tx ?? this.prisma;
    const row = await client.notificationPreference.findUnique({
      where: { userId_type: { userId, type } },
      select: { type: true, emailEnabled: true, inAppEnabled: true },
    });
    return resolveEffective(type, row);
  }
}
