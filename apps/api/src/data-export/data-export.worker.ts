import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { DataExportRequest } from '@prisma/client';
import { DataExportStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../storage/storage.provider';

import { assembleExportArchive } from './domain/assemble-export';
import { DataExportService } from './data-export.service';

/**
 * Background worker that picks up PENDING `DataExportRequest` rows,
 * assembles the ZIP, uploads it to S3, and flips the row to READY.
 *
 * Concurrency model
 * -----------------
 * We use Postgres's `SELECT ... FOR UPDATE SKIP LOCKED` to atomically
 * claim exactly one row per tick per API instance. That guarantees:
 *
 *   * Multiple API replicas can safely run this same worker without
 *     stepping on each other.
 *   * A slow worker holding one job never blocks a second worker
 *     from picking a different row.
 *   * A crashing worker releases its lock on transaction rollback,
 *     so the next tick reclaims the same row (`PENDING` stayed).
 *
 * Scheduling
 * ----------
 * The job-claim cron ticks every 30 seconds. DSAR is not a
 * high-throughput surface — a user requests one every 24 hours at
 * most — but a 30 s ceiling on start latency keeps the perceived
 * "click and wait" tight.
 *
 * The retention sweep runs daily at 03:15 (offset from the overtime
 * scheduler at 02:00 and the auto-absent job at 03:00) to avoid
 * piling up long-running work in the same minute.
 */
@Injectable()
export class DataExportWorker {
  private readonly logger = new Logger(DataExportWorker.name);
  private tickRunning = false;
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly service: DataExportService,
    config: ConfigService,
  ) {
    // Ops kill switch — set `DATA_EXPORT_WORKER_ENABLED=false` in the
    // env to move processing to a dedicated node while the API stays
    // read-only. The controller keeps accepting new PENDING rows.
    this.enabled =
      config.get<string>('DATA_EXPORT_WORKER_ENABLED', 'true') !== 'false';
    if (!this.enabled) {
      this.logger.warn(
        'DATA_EXPORT_WORKER_ENABLED=false — this API instance will NOT process exports.',
      );
    }
  }

  @Cron('*/30 * * * * *', { name: 'data-export-tick' })
  async tick(): Promise<void> {
    if (!this.enabled || this.tickRunning) return;
    this.tickRunning = true;
    try {
      // Loop until we run out of claimable jobs. Bounded per tick so a
      // huge backlog doesn't starve the cron scheduler.
      for (let i = 0; i < 5; i += 1) {
        const row = await this.claimNext();
        if (!row) return;
        await this.processOne(row);
      }
    } catch (err) {
      // Defensive — any escape here would tear down the scheduler.
      this.logger.error(
        { err },
        'data export tick failed with an unhandled error',
      );
    } finally {
      this.tickRunning = false;
    }
  }

  @Cron('15 3 * * *', { name: 'data-export-retention' })
  async retentionSweep(): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.service.expireOverdue();
    } catch (err) {
      this.logger.error(
        { err },
        'data export retention sweep failed',
      );
    }
  }

  /**
   * Atomically pick + flip one PENDING row to PROCESSING. Returns
   * `null` when the queue is empty. Uses `$transaction` + a raw
   * `SELECT ... FOR UPDATE SKIP LOCKED` so the row is unavailable to
   * other workers between the select and the update.
   */
  private async claimNext(): Promise<DataExportRequest | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "DataExportRequest"
         WHERE "status" = 'PENDING'
         ORDER BY "requestedAt" ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
      );
      const first = rows[0];
      if (!first) return null;
      return tx.dataExportRequest.update({
        where: { id: first.id },
        data: {
          status: DataExportStatus.PROCESSING,
          startedAt: new Date(),
        },
      });
    });
  }

  private async processOne(row: DataExportRequest): Promise<void> {
    const started = Date.now();
    this.logger.log(`assembling export requestId=${row.id} userId=${row.userId}`);

    try {
      const { buffer, size } = await assembleExportArchive(this.prisma, {
        userId: row.userId,
        companyId: row.companyId,
        requestId: row.id,
        requestedAt: row.requestedAt,
      });

      const fileKey = this.buildFileKey(row);
      await this.storage.putObject({
        key: fileKey,
        body: buffer,
        contentType: 'application/zip',
        contentLength: size,
      });

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 3_600_000);
      await this.prisma.$transaction(async (tx) => {
        await tx.dataExportRequest.update({
          where: { id: row.id },
          data: {
            status: DataExportStatus.READY,
            completedAt: now,
            expiresAt,
            fileKey,
            fileSize: size,
          },
        });
        await tx.auditLog.create({
          data: {
            companyId: row.companyId,
            actorId: row.userId,
            action: 'DATA_EXPORT_COMPLETED',
            entityType: 'DataExportRequest',
            entityId: row.id,
            afterJson: {
              fileSize: size,
              expiresAt: expiresAt.toISOString(),
            },
          },
        });
      });

      this.logger.log(
        `export ready requestId=${row.id} bytes=${size} durationMs=${
          Date.now() - started
        }`,
      );
    } catch (err) {
      const reason = (err as Error).message?.slice(0, 500) ?? 'unknown error';
      this.logger.error(
        { err, requestId: row.id },
        `export assembly failed reason=${reason}`,
      );
      await this.prisma.$transaction(async (tx) => {
        await tx.dataExportRequest.update({
          where: { id: row.id },
          data: {
            status: DataExportStatus.FAILED,
            failedAt: new Date(),
            failureReason: reason,
          },
        });
        await tx.auditLog.create({
          data: {
            companyId: row.companyId,
            actorId: row.userId,
            action: 'DATA_EXPORT_FAILED',
            entityType: 'DataExportRequest',
            entityId: row.id,
            afterJson: { reason },
          },
        });
      });
    }
  }

  private buildFileKey(row: DataExportRequest): string {
    return `data-exports/${row.companyId}/${row.userId}/${row.id}.zip`;
  }
}
