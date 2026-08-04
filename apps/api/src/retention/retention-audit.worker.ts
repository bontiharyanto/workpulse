import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { RetentionAuditReport } from '@prisma/client';

import { RetentionAuditService } from './retention-audit.service';
import { RetentionService } from './retention.service';
import { retentionAuditGap } from '../notification/domain/templates';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';

const MONTH_LABELS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

/**
 * OPS-6 — Retention Enforcement Audit worker.
 *
 * Fires on day 1 of every month at 05:30 UTC (after the 02:00 daily
 * retention sweep has had one last chance to catch up). For every
 * active tenant:
 *
 *   1. Generate the audit report for the previous calendar month.
 *   2. If the derived status is anything other than SUCCESS, dispatch
 *      an in-app + email notification to every HR_MANAGER / SUPER_ADMIN
 *      of the tenant (the "DPO channel").
 *
 * Notifications are idempotent because upsert-then-notify sees the
 * same status twice in a row → still fires. That is acceptable for
 * the monthly cadence — the DPO wants a monthly nudge either way.
 * The manual regenerate endpoint intentionally DOES NOT re-notify to
 * avoid alert spam during forensic reruns.
 *
 * Kill switch: `RETENTION_AUDIT_WORKER_ENABLED`. Default `true`.
 */
@Injectable()
export class RetentionAuditWorker {
  private readonly logger = new Logger(RetentionAuditWorker.name);
  private readonly enabled: boolean;
  private tickRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: RetentionAuditService,
    private readonly retention: RetentionService,
    private readonly notifications: NotificationService,
    config: ConfigService,
  ) {
    this.enabled = config.get<string>('RETENTION_AUDIT_WORKER_ENABLED', 'true') !== 'false';
    if (!this.enabled) {
      this.logger.warn(
        'RETENTION_AUDIT_WORKER_ENABLED=false — monthly audit disabled on this instance.',
      );
    }
  }

  /**
   * Day 1 of every month at 05:30 UTC. The 5h30m offset from the
   * 02:00 retention sweep gives that worker a solid buffer to finish
   * before we take a snapshot of its work.
   */
  @Cron('0 30 5 1 * *', { name: 'retention-audit' })
  async tick(): Promise<void> {
    if (!this.enabled) return;
    if (this.tickRunning) {
      this.logger.warn('previous retention-audit tick still running; skip');
      return;
    }
    this.tickRunning = true;
    const started = Date.now();
    try {
      const generated = await this.runOnce(new Date());
      this.logger.log(
        `retention-audit tick complete generated=${generated} durationMs=${Date.now() - started}`,
      );
    } catch (err) {
      this.logger.error(`retention-audit tick threw: ${(err as Error).message}`);
    } finally {
      this.tickRunning = false;
    }
  }

  /**
   * Reusable core — takes an explicit `reference` so tests can pin the
   * clock. Returns the count of reports generated (one per active
   * tenant). Exposed for the test-support endpoint too.
   */
  async runOnce(reference: Date, opts: { notify?: boolean } = {}): Promise<number> {
    const notify = opts.notify !== false;
    const targets = await this.retention.listCompaniesForSweep();
    let generated = 0;
    for (const target of targets) {
      try {
        const report = await this.audit.generatePreviousMonth(target.companyId, reference);
        generated += 1;
        if (notify && report.status !== 'SUCCESS') {
          await this.notifyGap(report).catch((err: Error) =>
            this.logger.warn(
              `notifyGap failed companyId=${target.companyId} reportId=${report.id}: ${err.message}`,
            ),
          );
        }
      } catch (err) {
        this.logger.error(
          `retention audit failed companyId=${target.companyId}: ${(err as Error).message}`,
        );
      }
    }
    return generated;
  }

  private async notifyGap(report: RetentionAuditReport): Promise<void> {
    // Snapshot HR_MANAGER + SUPER_ADMIN for the tenant. Empty list =
    // no dispatch (nothing to escalate to). We do not fall back to a
    // catch-all address — a tenant without a DPO is a config bug.
    const dpos = await this.prisma.user.findMany({
      where: {
        companyId: report.companyId,
        deletedAt: null,
        role: { in: ['HR_MANAGER', 'SUPER_ADMIN'] },
      },
      select: { id: true, email: true },
    });
    if (dpos.length === 0) {
      this.logger.warn(
        `no DPO recipients for retention audit gap companyId=${report.companyId} reportId=${report.id}`,
      );
      return;
    }

    const periodLabel = `${MONTH_LABELS[report.periodStart.getUTCMonth()]} ${report.periodStart.getUTCFullYear()}`;
    const findings = Array.isArray(report.findings) ? report.findings : [];
    const content = retentionAuditGap({
      reportId: report.id,
      periodLabel,
      status: report.status === 'WORKER_INACTIVE' ? 'WORKER_INACTIVE' : 'GAP_DETECTED',
      findingCount: findings.length,
    });

    await this.notifications.createMany(
      dpos.map((u) => ({
        companyId: report.companyId,
        recipientId: u.id,
        content,
        recipientEmail: u.email,
      })),
    );
  }
}
