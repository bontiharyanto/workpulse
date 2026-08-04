import { randomBytes } from 'node:crypto';

import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatcher } from '../webhook/webhook-dispatcher.service';

import { sign, verify, type VerifyResult } from './domain/share-signature';
import {
  type ExportResult,
  TimesheetExportService,
} from './timesheet-export.service';

export interface CreateShareInput {
  ttlHours?: number;
  note?: string | null;
}

export interface ShareUrl {
  id: string;
  url: string;
  expiresAt: Date;
  note: string | null;
  createdAt: Date;
}

export interface ShareListItem {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  downloadCount: number;
  lastDownloadedAt: string | null;
  note: string | null;
  createdBy: { id: string; fullName: string; email: string };
  revokedBy: { id: string; fullName: string; email: string } | null;
  active: boolean;
}

const SHARE_DOWNLOAD_PATH = '/api/v1/public/timesheet-exports/download';

/**
 * Fase 32d — creator + verifier for signed timesheet-export download
 * URLs.
 *
 * Trust model:
 *   1. Only HR / SUPER_ADMIN of the export's tenant can mint a share.
 *   2. The URL carries an HMAC-SHA256 over `${shareId}:${expiresAt}`
 *      keyed by `TIMESHEET_EXPORT_SIGNING_SECRET`. Vendors receive the
 *      URL and open it without a JWT.
 *   3. On download the service re-renders the payload from the same
 *      audit row that produced the original hash. If the re-render
 *      diverges the download is refused with 409 `EXPORT_DATA_DRIFTED`
 *      — this catches the case where an approved timesheet was
 *      unlocked or corrected between export-time and vendor pickup.
 *   4. Revocation is a soft flag: setting `revokedAt` makes the same
 *      URL respond 403 immediately, even though the signature still
 *      verifies. Rotating `TIMESHEET_EXPORT_SIGNING_SECRET` invalidates
 *      every issued URL globally.
 */
@Injectable()
export class TimesheetExportShareService implements OnModuleInit {
  private readonly logger = new Logger(TimesheetExportShareService.name);
  /**
   * Signing secret loaded once at boot. In dev we generate a random
   * per-process value so links keep working without operator setup;
   * production is required to provide one (env.validation refuses
   * otherwise). Never write this value to logs or the response body.
   */
  private signingSecret!: string;
  private defaultTtlHours!: number;
  private publicApiUrl!: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly exportService: TimesheetExportService,
    private readonly webhookDispatcher: WebhookDispatcher,
  ) {}

  onModuleInit(): void {
    const configured = this.config.get<string>(
      'TIMESHEET_EXPORT_SIGNING_SECRET',
    );
    if (configured) {
      this.signingSecret = configured;
    } else {
      // Dev fallback — random per boot so tests can rely on a stable
      // "same process, links keep working". Production is gated by
      // env.validation.superRefine to require a real secret.
      this.signingSecret = randomBytes(32).toString('base64');
      this.logger.warn(
        'TIMESHEET_EXPORT_SIGNING_SECRET not set — using an ephemeral random secret for this process. Links will not survive a restart.',
      );
    }
    this.defaultTtlHours = this.config.get<number>(
      'TIMESHEET_EXPORT_SHARE_TTL_HOURS',
      24,
    );
    this.publicApiUrl = (
      this.config.get<string>('PUBLIC_API_URL') ?? 'http://localhost:4000'
    ).replace(/\/+$/, '');
  }

  async create(
    actor: AuthenticatedUser,
    exportId: string,
    input: CreateShareInput,
  ): Promise<ShareUrl> {
    this.assertRole(actor);

    const exportRow = await this.prisma.timesheetExport.findFirst({
      where: { id: exportId, companyId: actor.companyId },
      select: { id: true },
    });
    if (!exportRow) throw new NotFoundException('EXPORT_NOT_FOUND');

    // Clamp TTL to the same 1..168 window enforced on the env default,
    // so a caller passing an out-of-range value gets a 400 rather than
    // silently minting a 30-day URL.
    const ttlHours = input.ttlHours ?? this.defaultTtlHours;
    if (ttlHours < 1 || ttlHours > 168 || !Number.isFinite(ttlHours)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'SHARE_TTL_OUT_OF_RANGE',
        message: 'ttlHours harus 1..168.',
      });
    }
    const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);

    const share = await this.prisma.$transaction(async (tx) => {
      const row = await tx.timesheetExportShare.create({
        data: {
          exportId,
          companyId: actor.companyId,
          createdById: actor.id,
          expiresAt,
          note: input.note?.trim() || null,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'TIMESHEET_EXPORT_SHARED',
          entityType: 'TimesheetExportShare',
          entityId: row.id,
          afterJson: {
            exportId,
            expiresAt: expiresAt.toISOString(),
            note: row.note,
          } as Prisma.InputJsonValue,
        },
      });
      return row;
    });

    const url = this.buildUrl(share.id, share.expiresAt);

    // Fase 32e — outbound webhook. Deliberately after commit, never
    // blocks the caller on failure (dispatcher swallows). Payload
    // carries the SIGNED URL so payroll vendors can auto-download.
    await this.webhookDispatcher.enqueue({
      companyId: actor.companyId,
      eventType: 'TIMESHEET_EXPORT_SHARE_CREATED',
      sourceId: share.id,
      data: {
        shareId: share.id,
        exportId,
        downloadUrl: url,
        expiresAt: share.expiresAt.toISOString(),
        note: share.note,
        createdBy: {
          id: actor.id,
          email: actor.email,
        },
      },
    });

    return {
      id: share.id,
      url,
      expiresAt: share.expiresAt,
      note: share.note,
      createdAt: share.createdAt,
    };
  }

  async revoke(
    actor: AuthenticatedUser,
    exportId: string,
    shareId: string,
  ): Promise<void> {
    this.assertRole(actor);
    const share = await this.prisma.timesheetExportShare.findFirst({
      where: { id: shareId, exportId, companyId: actor.companyId },
    });
    if (!share) throw new NotFoundException('SHARE_NOT_FOUND');
    if (share.revokedAt) {
      // Idempotent — a second revoke is a no-op, not a 409. Vendors may
      // call this concurrently.
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.timesheetExportShare.update({
        where: { id: shareId },
        data: { revokedAt: new Date(), revokedById: actor.id },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'TIMESHEET_EXPORT_SHARE_REVOKED',
          entityType: 'TimesheetExportShare',
          entityId: shareId,
        },
      });
    });
  }

  async listForExport(
    actor: AuthenticatedUser,
    exportId: string,
  ): Promise<ShareListItem[]> {
    this.assertRole(actor);
    const rows = await this.prisma.timesheetExportShare.findMany({
      where: { exportId, companyId: actor.companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
        revokedBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      revokedAt: r.revokedAt?.toISOString() ?? null,
      downloadCount: r.downloadCount,
      lastDownloadedAt: r.lastDownloadedAt?.toISOString() ?? null,
      note: r.note,
      createdBy: r.createdBy,
      revokedBy: r.revokedBy,
      active:
        r.revokedAt === null && r.expiresAt.getTime() > now,
    }));
  }

  /**
   * Verify the signature + DB state for a public download attempt and
   * return the payload if everything checks out. Re-renders the export
   * from the source rows and refuses if the hash diverges from the
   * audit row (`EXPORT_DATA_DRIFTED`). Increments `downloadCount` on
   * success.
   *
   * The endpoint returning this is *unauthenticated* by design — the
   * signature is the only authorisation. Every failure path returns a
   * generic 403 to the client; the specific reason is only logged.
   */
  async verifyAndDownload(
    shareId: string,
    expiresAtMs: number,
    presentedSignature: string,
    downloaderIp?: string,
  ): Promise<{ result: ExportResult; shareId: string }> {
    const verifyResult: VerifyResult = verify(
      this.signingSecret,
      { shareId, expiresAtMs },
      presentedSignature,
    );
    if (!verifyResult.ok) {
      this.logger.warn(
        `share verify failed: reason=${verifyResult.reason} shareId=${shareId} ip=${downloaderIp ?? '-'}`,
      );
      throw new ForbiddenException('SHARE_INVALID');
    }

    const share = await this.prisma.timesheetExportShare.findUnique({
      where: { id: shareId },
      include: {
        export: { select: { id: true, companyId: true, payloadSha256: true } },
      },
    });
    if (!share) throw new ForbiddenException('SHARE_INVALID');
    if (share.revokedAt) {
      this.logger.warn(`share revoked: shareId=${shareId}`);
      throw new ForbiddenException('SHARE_REVOKED');
    }
    if (share.expiresAt.getTime() !== expiresAtMs) {
      // Defence-in-depth: the signature covers a specific expiresAt,
      // but a client could still present a different pair. Refuse.
      this.logger.warn(
        `share expiry mismatch: shareId=${shareId} presented=${expiresAtMs} db=${share.expiresAt.getTime()}`,
      );
      throw new ForbiddenException('SHARE_INVALID');
    }

    // Serve the exact byte-string persisted at export time (Fase 32d
    // stored the payload alongside the audit row so vendors receive
    // byte-identical files regardless of downstream data changes).
    // `loadPayloadForShare` also cross-checks the stored hash against
    // the actual bytes as an anti-tamper signal.
    const loaded = await this.exportService.loadPayloadForShare(
      share.export.id,
    );

    // Success — bump counters.
    await this.prisma.$transaction(async (tx) => {
      await tx.timesheetExportShare.update({
        where: { id: shareId },
        data: {
          downloadCount: { increment: 1 },
          lastDownloadedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: share.companyId,
          actorId: null,
          action: 'TIMESHEET_EXPORT_SHARE_DOWNLOADED',
          entityType: 'TimesheetExportShare',
          entityId: shareId,
          afterJson: {
            exportId: share.export.id,
            ip: downloaderIp ?? null,
          } as Prisma.InputJsonValue,
        },
      });
    });

    return { result: loaded, shareId };
  }

  private buildUrl(shareId: string, expiresAt: Date): string {
    const expiresAtMs = expiresAt.getTime();
    const signature = sign(this.signingSecret, { shareId, expiresAtMs });
    const params = new URLSearchParams({
      id: shareId,
      expires: String(expiresAtMs),
      signature,
    });
    return `${this.publicApiUrl}${SHARE_DOWNLOAD_PATH}?${params.toString()}`;
  }

  private assertRole(actor: AuthenticatedUser): void {
    if (actor.role !== 'HR_MANAGER' && actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('FORBIDDEN');
    }
  }
}
