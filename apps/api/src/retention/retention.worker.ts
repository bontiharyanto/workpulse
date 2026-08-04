import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';

import { DataErasureService } from '../data-erasure/data-erasure.service';
import { PrismaService } from '../prisma/prisma.service';
import { listAutoErasureCandidates, pruneNotifications } from './domain/retention-actions';
import { RetentionService } from './retention.service';
import { anonymizeUser } from '../data-erasure/domain/anonymize-user';

/**
 * Retention worker (Fase 31c). Runs once per day at 02:00 UTC and
 * sweeps per-tenant retention actions:
 *
 *   1. `Notification` rows older than
 *      `RetentionPolicy.notificationRetentionDays` are deleted.
 *   2. TERMINATED users older than
 *      `RetentionPolicy.terminatedUserAnonymizeDays` are
 *      auto-anonymised via the shared `anonymizeUser` helper.
 *
 * Data-export archive retention is enforced by the DSAR worker
 * (`DataExportWorker.retentionSweep`) so we don't double-execute
 * it here — this worker only provides the tenant-configurable
 * hours value; DSAR reads it during its own sweep.
 *
 * We use per-tenant transactions to keep the blast radius small.
 * A crash mid-tenant leaves the earlier tenants durably swept
 * and the later ones untouched — the next daily run picks them up.
 */
@Injectable()
export class RetentionWorker {
  private readonly logger = new Logger(RetentionWorker.name);
  private tickRunning = false;
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly service: RetentionService,
    private readonly erasureService: DataErasureService,
    config: ConfigService,
  ) {
    this.enabled = config.get<string>('RETENTION_WORKER_ENABLED', 'true') !== 'false';
    if (!this.enabled) {
      this.logger.warn(
        'RETENTION_WORKER_ENABLED=false — retention sweeps disabled on this instance.',
      );
    }
  }

  @Cron('0 0 2 * * *', { name: 'retention-sweep' })
  async tick(): Promise<void> {
    if (!this.enabled || this.tickRunning) return;
    this.tickRunning = true;
    const started = Date.now();
    try {
      const targets = await this.service.listCompaniesForSweep();
      for (const target of targets) {
        await this.sweepOne(target.companyId, target.policy).catch((err: Error) =>
          this.logger.error(
            { err, companyId: target.companyId },
            `retention sweep failed for tenant: ${err.message}`,
          ),
        );
      }
      this.logger.log(
        `retention sweep complete tenants=${targets.length} durationMs=${Date.now() - started}`,
      );
    } finally {
      this.tickRunning = false;
    }
  }

  /**
   * Manual trigger for E2E / ops. Bypasses the reentrancy guard so
   * it can be called even if a cron tick is in flight; callers
   * accept the risk of overlap.
   */
  async runOnce(): Promise<void> {
    const targets = await this.service.listCompaniesForSweep();
    for (const target of targets) {
      await this.sweepOne(target.companyId, target.policy).catch((err: Error) =>
        this.logger.error(
          { err, companyId: target.companyId },
          `retention runOnce failed for tenant: ${err.message}`,
        ),
      );
    }
  }

  private async sweepOne(
    companyId: string,
    policy: {
      notificationRetentionDays: number;
      terminatedUserAnonymizeDays: number;
    },
  ): Promise<void> {
    const now = new Date();

    // 1. Notification prune. Standalone tx — no cross-dependency
    // on the anonymisation loop below.
    if (policy.notificationRetentionDays > 0) {
      const deleted = await this.prisma.$transaction(async (tx) => {
        const count = await pruneNotifications(
          tx,
          companyId,
          policy.notificationRetentionDays,
          now,
        );
        if (count > 0) {
          await tx.auditLog.create({
            data: {
              companyId,
              // System actor — retention runs without a human trigger.
              // We record `null` actorId which the audit reader UI
              // renders as "System".
              actorId: null,
              action: 'RETENTION_NOTIFICATIONS_PRUNED',
              entityType: 'Notification',
              entityId: `sweep-${now.toISOString()}`,
              afterJson: {
                deletedCount: count,
                retentionDays: policy.notificationRetentionDays,
              } as Prisma.InputJsonValue,
            },
          });
        }
        return count;
      });
      if (deleted > 0) {
        this.logger.log(`notifications pruned companyId=${companyId} count=${deleted}`);
      }
    }

    // 2. Auto-anonymise TERMINATED users past the threshold.
    if (policy.terminatedUserAnonymizeDays > 0) {
      // Read outside the tx so we get a stable snapshot of candidate
      // IDs, then anonymise each in its own tx.
      const candidates = await listAutoErasureCandidates(
        this.prisma,
        companyId,
        policy.terminatedUserAnonymizeDays,
        now,
      );
      for (const cand of candidates) {
        await this.anonymiseOne(companyId, cand, now).catch((err: Error) =>
          this.logger.warn(`auto-erasure failed userId=${cand.id} reason=${err.message}`),
        );
      }
      if (candidates.length > 0) {
        this.logger.log(`auto-erasure companyId=${companyId} count=${candidates.length}`);
      }
    }
  }

  private async anonymiseOne(
    companyId: string,
    cand: { id: string; email: string; deletedAt: Date },
    now: Date,
  ): Promise<void> {
    const result = await this.prisma.$transaction(async (tx) => {
      const r = await anonymizeUser(tx, {
        userId: cand.id,
        companyId,
        // Synthetic request-id — no `DataErasureRequest` row backs an
        // auto-erasure. The audit log stitches things together via
        // the `RETENTION_USER_AUTO_ANONYMIZED` action.
        erasureRequestId: `retention-${now.toISOString()}`,
        now,
      });
      await tx.auditLog.create({
        data: {
          companyId,
          actorId: null,
          action: 'RETENTION_USER_AUTO_ANONYMIZED',
          entityType: 'User',
          entityId: cand.id,
          beforeJson: {
            email: cand.email,
            deletedAt: cand.deletedAt.toISOString(),
          } as Prisma.InputJsonValue,
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
      return r;
    });

    if (result.dataExportFileKeys.length > 0) {
      await this.erasureService.deleteExportedArchives(result.dataExportFileKeys);
    }
  }
}
