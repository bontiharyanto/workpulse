import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DataExportRequest, Prisma } from '@prisma/client';
import { DataExportStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../storage/storage.provider';

/**
 * DSAR service. Enforces the "one open OR recent" rate limit at the
 * business layer (deliberately not in the throttler — this is a
 * per-user 24h cooldown, not a per-IP burst limit) and exposes the
 * read + download surface.
 *
 * The heavy lifting — actually assembling the ZIP — is done by
 * `DataExportWorker` running under `@nestjs/schedule`. This service
 * only creates PENDING rows and hands out fresh presigned URLs on
 * demand.
 */
@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);
  private readonly cooldownMs: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    config: ConfigService,
  ) {
    // Cooldown between two successful requests. 24h is the sane
    // default recommended by every DSAR runbook — it keeps a
    // motivated user from DOS'ing the assembler while remaining
    // responsive for a genuine "download it now, I forgot" retry.
    this.cooldownMs = Number(config.get<string>('DATA_EXPORT_COOLDOWN_HOURS', '24')) * 3_600_000;
  }

  /**
   * Enqueue a new export. Throws 409 CONFLICT with a machine-readable
   * `code` when the caller violates one of the two rate rules:
   *
   *   * `EXPORT_ALREADY_PENDING` — an in-flight PENDING or PROCESSING
   *     request exists. The FE should show that row's status instead
   *     of nagging for a new one.
   *   * `EXPORT_COOLDOWN` — the last request landed less than
   *     `DATA_EXPORT_COOLDOWN_HOURS` ago. The `nextAllowedAt` field
   *     on the 409 body tells the FE when to unlock the button.
   */
  async create(userId: string, companyId: string): Promise<DataExportRequest> {
    const now = Date.now();

    // 1. Reject if there's already an active job for this user.
    const inFlight = await this.prisma.dataExportRequest.findFirst({
      where: {
        userId,
        status: { in: [DataExportStatus.PENDING, DataExportStatus.PROCESSING] },
      },
      orderBy: { requestedAt: 'desc' },
    });
    if (inFlight) {
      throw new ConflictException({
        statusCode: 409,
        code: 'EXPORT_ALREADY_PENDING',
        message: 'Permintaan ekspor data sudah berjalan. Tunggu sampai selesai.',
        details: { requestId: inFlight.id, status: inFlight.status },
      });
    }

    // 2. Reject if last request is within the cooldown window.
    const lastRequest = await this.prisma.dataExportRequest.findFirst({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
    });
    if (lastRequest) {
      const nextAllowedAt = new Date(lastRequest.requestedAt.getTime() + this.cooldownMs);
      if (nextAllowedAt.getTime() > now) {
        throw new ConflictException({
          statusCode: 409,
          code: 'EXPORT_COOLDOWN',
          message: `Permintaan ekspor data hanya bisa dilakukan sekali per ${
            this.cooldownMs / 3_600_000
          } jam. Coba lagi setelah ${nextAllowedAt.toISOString()}.`,
          details: { nextAllowedAt: nextAllowedAt.toISOString() },
        });
      }
    }

    // 3. Create the PENDING row + audit in one transaction.
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.dataExportRequest.create({
        data: {
          userId,
          companyId,
          status: DataExportStatus.PENDING,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId,
          actorId: userId,
          action: 'DATA_EXPORT_REQUESTED',
          entityType: 'DataExportRequest',
          entityId: row.id,
        },
      });
      this.logger.log(
        `data export requested requestId=${row.id} userId=${userId} companyId=${companyId}`,
      );
      return row;
    });
  }

  /**
   * List every request for the caller, newest-first. `downloadUrl`
   * stays `null` here — the FE calls `GET /:id/download` to mint a
   * fresh presigned URL only when the user clicks. That way stale
   * URLs never end up in bookmark bars or shared screenshots.
   */
  async list(userId: string): Promise<(DataExportRequest & { downloadUrl: null })[]> {
    const rows = await this.prisma.dataExportRequest.findMany({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
      take: 25,
    });
    return rows.map((r) => ({ ...r, downloadUrl: null }));
  }

  /**
   * Mint a fresh presigned URL for a READY export. 4 failure modes,
   * each with a distinct code so the FE can render the right copy:
   *
   *   * 404 EXPORT_NOT_FOUND  — id doesn't exist or belongs to
   *                             another user (no existence leak).
   *   * 409 EXPORT_NOT_READY — status is PENDING / PROCESSING.
   *   * 409 EXPORT_FAILED    — status is FAILED.
   *   * 410 EXPORT_EXPIRED   — status is EXPIRED (S3 object gone).
   */
  async getDownloadUrl(
    userId: string,
    requestId: string,
  ): Promise<{ downloadUrl: string; expiresIn: number }> {
    const row = await this.prisma.dataExportRequest.findUnique({
      where: { id: requestId },
    });
    if (!row || row.userId !== userId) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'EXPORT_NOT_FOUND',
        message: 'Permintaan ekspor tidak ditemukan.',
      });
    }
    if (row.status === DataExportStatus.PENDING || row.status === DataExportStatus.PROCESSING) {
      throw new ConflictException({
        statusCode: 409,
        code: 'EXPORT_NOT_READY',
        message: 'Arsip masih diproses. Silakan tunggu.',
      });
    }
    if (row.status === DataExportStatus.FAILED) {
      throw new ConflictException({
        statusCode: 409,
        code: 'EXPORT_FAILED',
        message: 'Pembuatan arsip gagal. Silakan ajukan ulang.',
        details: { failureReason: row.failureReason },
      });
    }
    if (row.status === DataExportStatus.EXPIRED || !row.fileKey) {
      throw new BadRequestException({
        statusCode: 410,
        code: 'EXPORT_EXPIRED',
        message: 'Arsip sudah kedaluwarsa. Silakan ajukan permintaan baru.',
      });
    }

    // Mint. Note: we intentionally do NOT audit downloads — the
    // audit event would double for every retry click. The
    // enqueueing + completion events already record intent.
    const filename = `workpulse-data-export-${row.id}.zip`;
    const { url, expiresIn } = await this.storage.presignGet({
      key: row.fileKey,
      downloadFilename: filename,
    });

    // Best-effort DOWNLOADED audit — one per URL mint, throttled by
    // the presigned URL's own TTL upstream. Kept as a separate write
    // outside any tx because it's advisory.
    await this.prisma.auditLog
      .create({
        data: {
          companyId: row.companyId,
          actorId: userId,
          action: 'DATA_EXPORT_DOWNLOAD_URL_ISSUED',
          entityType: 'DataExportRequest',
          entityId: row.id,
          afterJson: { fileKey: row.fileKey } as Prisma.InputJsonValue,
        },
      })
      .catch((err: Error) =>
        this.logger.warn(
          `audit write for download URL issuance failed requestId=${row.id}: ${err.message}`,
        ),
      );

    return { downloadUrl: url, expiresIn };
  }

  /**
   * Sweep expired archives. Called by the same worker as job pick-up
   * on a slower cadence — but exposed here as its own method so it
   * can also be triggered from a runbook if the daily sweep ever
   * fails.
   *
   * Semantics: for every row with `status=READY AND expiresAt < now`,
   * delete the S3 object (best-effort) and flip the row to EXPIRED
   * with the `fileKey` wiped. The audit `DATA_EXPORT_EXPIRED` is
   * emitted per row.
   */
  async expireOverdue(now = new Date()): Promise<{ expired: number }> {
    const overdue = await this.prisma.dataExportRequest.findMany({
      where: {
        status: DataExportStatus.READY,
        expiresAt: { lt: now },
      },
      take: 100,
    });

    let expired = 0;
    for (const row of overdue) {
      try {
        if (row.fileKey) {
          await this.storage.deleteObject(row.fileKey);
        }
      } catch (err) {
        this.logger.warn(
          `expireOverdue: S3 delete failed requestId=${row.id}: ${(err as Error).message}`,
        );
        // fall through — we still flip the row to EXPIRED so we don't
        // reprocess it on every sweep. The object may already be gone.
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.dataExportRequest.update({
          where: { id: row.id },
          data: {
            status: DataExportStatus.EXPIRED,
            fileKey: null,
          },
        });
        await tx.auditLog.create({
          data: {
            companyId: row.companyId,
            actorId: row.userId,
            action: 'DATA_EXPORT_EXPIRED',
            entityType: 'DataExportRequest',
            entityId: row.id,
          },
        });
      });
      expired += 1;
    }
    if (expired > 0) {
      this.logger.log(`expireOverdue: flipped ${expired} row(s) to EXPIRED`);
    }
    return { expired };
  }
}
