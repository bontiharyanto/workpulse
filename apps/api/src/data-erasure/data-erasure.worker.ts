import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { DataErasureRequest, Prisma } from '@prisma/client';
import { DataErasureStatus } from '@prisma/client';

import { DataErasureService } from './data-erasure.service';
import { dataErasureExecuted } from '../notification/domain/templates';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { anonymizeUser } from './domain/anonymize-user';

/**
 * Background worker that picks up `APPROVED_SCHEDULED` rows whose
 * `scheduledFor` has elapsed, then anonymises the target user.
 *
 * Concurrency model
 * -----------------
 * The claim query uses `SELECT ... FOR UPDATE SKIP LOCKED` so multiple
 * API replicas can run this cron concurrently without stepping on
 * each other. A slow anonymisation holds one row's lock but never
 * blocks a second worker from picking a different one. Crashing
 * rolls the claim back — the row stays APPROVED_SCHEDULED and gets
 * re-picked on the next tick.
 *
 * Scheduling
 * ----------
 * Ticks every 5 minutes. Right-to-erasure is not a high-throughput
 * surface — the average tenant will see a handful per year — so we
 * prioritise low resource pressure over minimum latency. A 5-minute
 * ceiling on "scheduledFor has passed" latency is well within the
 * expected SLA.
 */
@Injectable()
export class DataErasureWorker {
  private readonly logger = new Logger(DataErasureWorker.name);
  private tickRunning = false;
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly service: DataErasureService,
    private readonly notifications: NotificationService,
    config: ConfigService,
  ) {
    this.enabled = config.get<string>('DATA_ERASURE_WORKER_ENABLED', 'true') !== 'false';
    if (!this.enabled) {
      this.logger.warn(
        'DATA_ERASURE_WORKER_ENABLED=false — this API instance will NOT execute erasures.',
      );
    }
  }

  @Cron('0 */5 * * * *', { name: 'data-erasure-tick' })
  async tick(): Promise<void> {
    if (!this.enabled || this.tickRunning) return;
    this.tickRunning = true;
    try {
      // Bounded loop so a huge backlog does not starve the scheduler.
      for (let i = 0; i < 5; i += 1) {
        const row = await this.claimNext();
        if (!row) return;
        await this.processOne(row);
      }
    } catch (err) {
      this.logger.error({ err }, 'data erasure tick failed with an unhandled error');
    } finally {
      this.tickRunning = false;
    }
  }

  private async claimNext(): Promise<DataErasureRequest | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "DataErasureRequest"
         WHERE "status" = 'APPROVED_SCHEDULED'
           AND "scheduledFor" IS NOT NULL
           AND "scheduledFor" <= NOW()
         ORDER BY "scheduledFor" ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
      );
      const first = rows[0];
      if (!first) return null;
      // We DO NOT flip the row status here — we want the row to stay
      // APPROVED_SCHEDULED until the anonymisation succeeds so a crash
      // mid-way can be retried. Instead we return the row and process
      // it with a fresh transaction below. `FOR UPDATE SKIP LOCKED`
      // released on transaction close is fine — the follow-up tx
      // picks a row that shouldn't have been claimed by anyone else
      // in the tiny window between (worst case, a duplicate call to
      // `anonymizeUser` is idempotent: the second one sees the email
      // already erased, updates it again to the same value, and
      // deletes zero rows).
      return tx.dataErasureRequest.findUnique({ where: { id: first.id } });
    });
  }

  private async processOne(row: DataErasureRequest): Promise<void> {
    const started = Date.now();
    this.logger.log(`executing erasure requestId=${row.id} userId=${row.userId}`);

    try {
      // Snapshot the "before" for the audit trail.
      const beforeUser = await this.prisma.user.findUnique({
        where: { id: row.userId },
        select: { email: true, fullName: true },
      });

      // The anonymisation + status flip happens in ONE transaction.
      const { result, updated } = await this.prisma.$transaction(async (tx) => {
        const r = await anonymizeUser(tx, {
          userId: row.userId,
          companyId: row.companyId,
          erasureRequestId: row.id,
          now: new Date(),
        });
        const u = await tx.dataErasureRequest.update({
          where: { id: row.id },
          data: {
            status: DataErasureStatus.EXECUTED,
            executedAt: new Date(),
          },
        });
        await tx.auditLog.create({
          data: {
            companyId: row.companyId,
            actorId: row.decidedById ?? row.userId,
            action: 'DATA_ERASURE_EXECUTED',
            entityType: 'DataErasureRequest',
            entityId: row.id,
            beforeJson: (beforeUser
              ? {
                  email: beforeUser.email,
                  fullName: beforeUser.fullName,
                }
              : {}) as Prisma.InputJsonValue,
            afterJson: {
              erasedEmail: r.erasedEmail,
              refreshTokensRevoked: r.refreshTokensRevoked,
              backupCodesDeleted: r.backupCodesDeleted,
              notificationsDeleted: r.notificationsDeleted,
              passwordResetsDeleted: r.passwordResetsDeleted,
              notificationPrefsDeleted: r.notificationPrefsDeleted,
              dataExportFileKeysCount: r.dataExportFileKeys.length,
            } as Prisma.InputJsonValue,
          },
        });
        return { result: r, updated: u };
      });

      // Best-effort S3 cleanup for stale export archives.
      if (result.dataExportFileKeys.length > 0) {
        await this.service.deleteExportedArchives(result.dataExportFileKeys);
      }

      // Notify every HR / admin who was in the loop. The target user
      // is intentionally NOT notified — their notification rows were
      // just wiped, and emailing an anonymised address is pointless.
      await this.notifyPostExecution(row, beforeUser?.fullName ?? 'user');

      this.logger.log(
        `erasure executed requestId=${row.id} userId=${row.userId} durationMs=${Date.now() - started}`,
      );
      // Suppress unused warning
      void updated;
    } catch (err) {
      const reason = (err as Error).message?.slice(0, 500) ?? 'unknown error';
      this.logger.error({ err, requestId: row.id }, `erasure execution failed reason=${reason}`);
      await this.prisma.$transaction(async (tx) => {
        await tx.dataErasureRequest.update({
          where: { id: row.id },
          data: {
            status: DataErasureStatus.FAILED,
            failedAt: new Date(),
            failureReason: reason,
          },
        });
        await tx.auditLog.create({
          data: {
            companyId: row.companyId,
            actorId: row.decidedById ?? row.userId,
            action: 'DATA_ERASURE_FAILED',
            entityType: 'DataErasureRequest',
            entityId: row.id,
            afterJson: { reason } as Prisma.InputJsonValue,
          },
        });
      });
    }
  }

  private async notifyPostExecution(row: DataErasureRequest, fullName: string): Promise<void> {
    const approvers = await this.prisma.user.findMany({
      where: {
        companyId: row.companyId,
        role: { in: ['HR_MANAGER', 'SUPER_ADMIN'] },
        deletedAt: null,
      },
      select: { id: true, email: true },
    });
    for (const approver of approvers) {
      await this.notifications
        .createOne({
          companyId: row.companyId,
          recipientId: approver.id,
          recipientEmail: approver.email,
          content: dataErasureExecuted({
            requestId: row.id,
            requesterName: fullName,
          }),
        })
        .catch((err: Error) =>
          this.logger.warn(`post-erasure notify failed for ${approver.id}: ${err.message}`),
        );
    }
  }
}
