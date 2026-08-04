import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  Prisma,
  RetentionAuditReport,
  RetentionAuditStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import {
  deriveRetentionAudit,
  previousUtcMonth,
  utcMonthRange,
  type RetentionAuditCounters,
  type RetentionAuditFinding,
  type RetentionAuditPolicySnapshot,
} from './domain/retention-audit-findings';
import { RetentionService } from './retention.service';

/** Regex used by the anonymisation helper to rewrite `User.email`. */
const ANONYMISED_EMAIL_PATTERN = 'anonymised-%@%';

const AUDIT_ACTIONS = {
  notificationsPruned: 'RETENTION_NOTIFICATIONS_PRUNED',
  userAnonymised: 'RETENTION_USER_AUTO_ANONYMIZED',
  dsarExpired: 'DATA_EXPORT_EXPIRED',
} as const;

interface ListOpts {
  status?: RetentionAuditStatus;
  page?: number;
  pageSize?: number;
}

/**
 * OPS-6 — Retention Enforcement Audit service.
 *
 * Generates and reads monthly attestations that the `RetentionWorker`
 * has honoured the tenant's `RetentionPolicy`. Purposely a separate
 * service from `RetentionService` so the read path is trivially
 * cache-able and the write path (worker) has a narrow surface.
 */
@Injectable()
export class RetentionAuditService {
  private readonly logger = new Logger(RetentionAuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly retention: RetentionService,
  ) {}

  // ---------------------------------------------------------------------------
  // Write path (called by the worker + manual regenerate)
  // ---------------------------------------------------------------------------

  /**
   * Compute + persist the audit report for `[periodStart, periodEnd)`.
   * Idempotent: re-runs for the same period upsert on the composite
   * `(companyId, periodStart)` unique index. Regenerating overwrites
   * every derived counter and the `findings` payload — the append-only
   * discipline lives in DB-level `REVOKE` (see migration), not in
   * this service.
   */
  async generateForPeriod(
    companyId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<RetentionAuditReport> {
    if (periodEnd <= periodStart) {
      throw new BadRequestException('AUDIT_PERIOD_INVALID');
    }

    const policy = await this.retention.getForCompany(companyId);
    const policySnapshot: RetentionAuditPolicySnapshot = {
      notificationRetentionDays: policy.notificationRetentionDays,
      dataExportArchiveRetentionHours: policy.dataExportArchiveRetentionHours,
      terminatedUserAnonymizeDays: policy.terminatedUserAnonymizeDays,
    };

    const counters = await this.collectCounters(
      companyId,
      periodStart,
      periodEnd,
      policySnapshot,
    );
    const workerLastRunAt = await this.workerLastRunAt(
      companyId,
      periodStart,
      periodEnd,
    );

    const derived = deriveRetentionAudit({
      counters,
      policy: policySnapshot,
      workerLastRunAt,
      periodStart,
      periodEnd,
    });

    const upserted = await this.prisma.retentionAuditReport.upsert({
      where: {
        one_report_per_tenant_per_period: {
          companyId,
          periodStart,
        },
      },
      create: {
        companyId,
        periodStart,
        periodEnd,
        status: derived.status,
        notificationsPruned: counters.notificationsPruned,
        usersAutoAnonymised: counters.usersAutoAnonymised,
        dsarArchivesExpired: counters.dsarArchivesExpired,
        notificationsPastRetention: counters.notificationsPastRetention,
        dsarArchivesPastRetention: counters.dsarArchivesPastRetention,
        terminatedUsersPastRetention: counters.terminatedUsersPastRetention,
        policySnapshot: policySnapshot as unknown as Prisma.InputJsonValue,
        workerLastRunAt: workerLastRunAt ?? undefined,
        findings: derived.findings as unknown as Prisma.InputJsonValue,
      },
      update: {
        periodEnd,
        status: derived.status,
        generatedAt: new Date(),
        notificationsPruned: counters.notificationsPruned,
        usersAutoAnonymised: counters.usersAutoAnonymised,
        dsarArchivesExpired: counters.dsarArchivesExpired,
        notificationsPastRetention: counters.notificationsPastRetention,
        dsarArchivesPastRetention: counters.dsarArchivesPastRetention,
        terminatedUsersPastRetention: counters.terminatedUsersPastRetention,
        policySnapshot: policySnapshot as unknown as Prisma.InputJsonValue,
        workerLastRunAt: workerLastRunAt ?? null,
        findings: derived.findings as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `retention audit generated companyId=${companyId} period=${periodStart.toISOString()} status=${derived.status} findings=${derived.findings.length}`,
    );
    return upserted;
  }

  /** Convenience: generate the report for the calendar month preceding `reference`. */
  async generatePreviousMonth(
    companyId: string,
    reference = new Date(),
  ): Promise<RetentionAuditReport> {
    const { periodStart, periodEnd } = previousUtcMonth(reference);
    return this.generateForPeriod(companyId, periodStart, periodEnd);
  }

  /**
   * Regenerate a specific calendar month (SUPER_ADMIN escape hatch — e.g.
   * after policy fix or worker bug post-mortem).
   */
  async regenerateMonth(
    companyId: string,
    year: number,
    monthIndex1To12: number,
  ): Promise<RetentionAuditReport> {
    const { periodStart, periodEnd } = utcMonthRange(year, monthIndex1To12);
    return this.generateForPeriod(companyId, periodStart, periodEnd);
  }

  // ---------------------------------------------------------------------------
  // Read path (called by controller)
  // ---------------------------------------------------------------------------

  async list(
    companyId: string,
    opts: ListOpts = {},
  ): Promise<{
    rows: RetentionAuditReport[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 12));
    const where: Prisma.RetentionAuditReportWhereInput = {
      companyId,
      ...(opts.status ? { status: opts.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.retentionAuditReport.findMany({
        where,
        orderBy: [{ periodStart: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.retentionAuditReport.count({ where }),
    ]);
    return { rows, total, page, pageSize };
  }

  async detail(
    companyId: string,
    reportId: string,
  ): Promise<RetentionAuditReport> {
    const row = await this.prisma.retentionAuditReport.findFirst({
      where: { id: reportId, companyId },
    });
    if (!row) {
      throw new NotFoundException('RETENTION_AUDIT_REPORT_NOT_FOUND');
    }
    return row;
  }

  /** Latest report per tenant — used by the FE landing card. */
  async latestForCompany(
    companyId: string,
  ): Promise<RetentionAuditReport | null> {
    return this.prisma.retentionAuditReport.findFirst({
      where: { companyId },
      orderBy: { periodStart: 'desc' },
    });
  }

  // ---------------------------------------------------------------------------
  // Internal collectors — pushed through `findMany` / `count` rather than
  // hand-rolled SQL so Prisma tenancy fences stay honoured.
  // ---------------------------------------------------------------------------

  private async collectCounters(
    companyId: string,
    periodStart: Date,
    periodEnd: Date,
    policy: RetentionAuditPolicySnapshot,
  ): Promise<RetentionAuditCounters> {
    const [
      notificationsPruned,
      usersAutoAnonymised,
      dsarArchivesExpired,
      notificationsPastRetention,
      dsarArchivesPastRetention,
      terminatedUsersPastRetention,
    ] = await Promise.all([
      this.sumAuditCount(
        companyId,
        AUDIT_ACTIONS.notificationsPruned,
        periodStart,
        periodEnd,
        'deletedCount',
      ),
      this.countAuditRows(
        companyId,
        AUDIT_ACTIONS.userAnonymised,
        periodStart,
        periodEnd,
      ),
      this.countAuditRows(
        companyId,
        AUDIT_ACTIONS.dsarExpired,
        periodStart,
        periodEnd,
      ),
      this.notificationsPastRetentionCount(
        companyId,
        policy.notificationRetentionDays,
      ),
      this.dsarArchivesPastRetentionCount(companyId),
      this.terminatedUsersPastRetentionCount(
        companyId,
        policy.terminatedUserAnonymizeDays,
      ),
    ]);
    return {
      notificationsPruned,
      usersAutoAnonymised,
      dsarArchivesExpired,
      notificationsPastRetention,
      dsarArchivesPastRetention,
      terminatedUsersPastRetention,
    };
  }

  private async countAuditRows(
    companyId: string,
    action: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<number> {
    return this.prisma.auditLog.count({
      where: {
        companyId,
        action,
        createdAt: { gte: periodStart, lt: periodEnd },
      },
    });
  }

  /**
   * Sum a numeric key inside `afterJson` (e.g. `deletedCount`).
   * We fetch the rows and reduce in-memory because Postgres cannot
   * easily aggregate JSONB fields via Prisma without a raw query,
   * and the row count per month is bounded (worker writes at most
   * once per tenant per day for each action).
   */
  private async sumAuditCount(
    companyId: string,
    action: string,
    periodStart: Date,
    periodEnd: Date,
    jsonKey: string,
  ): Promise<number> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        companyId,
        action,
        createdAt: { gte: periodStart, lt: periodEnd },
      },
      select: { afterJson: true },
    });
    let total = 0;
    for (const row of rows) {
      const raw = (row.afterJson as Record<string, unknown> | null)?.[jsonKey];
      if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
        total += raw;
      }
    }
    return total;
  }

  /**
   * `workerLastRunAt` = the max `createdAt` among any of the retention
   * actions during the period. Signals "the sweep tried at least once".
   */
  private async workerLastRunAt(
    companyId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Date | null> {
    const latest = await this.prisma.auditLog.findFirst({
      where: {
        companyId,
        action: {
          in: [
            AUDIT_ACTIONS.notificationsPruned,
            AUDIT_ACTIONS.userAnonymised,
          ],
        },
        createdAt: { gte: periodStart, lt: periodEnd },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return latest?.createdAt ?? null;
  }

  private async notificationsPastRetentionCount(
    companyId: string,
    retentionDays: number,
  ): Promise<number> {
    // Retention = "keep forever" — never past retention.
    if (retentionDays <= 0) return 0;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000);
    return this.prisma.notification.count({
      where: {
        companyId,
        createdAt: { lt: cutoff },
      },
    });
  }

  private async dsarArchivesPastRetentionCount(
    companyId: string,
  ): Promise<number> {
    // `expiresAt` was set by the DSAR worker when the archive was
    // committed. Post-expiry, the sweep is supposed to null the
    // `fileKey`. A row that still has `fileKey` past its expiry is
    // a gap.
    return this.prisma.dataExportRequest.count({
      where: {
        companyId,
        expiresAt: { lt: new Date() },
        fileKey: { not: null },
      },
    });
  }

  private async terminatedUsersPastRetentionCount(
    companyId: string,
    thresholdDays: number,
  ): Promise<number> {
    // Retention = "keep forever" — never past retention.
    if (thresholdDays <= 0) return 0;
    const cutoff = new Date(Date.now() - thresholdDays * 24 * 3600 * 1000);
    return this.prisma.user.count({
      where: {
        companyId,
        deletedAt: { lt: cutoff, not: null },
        // Non-anonymised email = real address still on file.
        email: { not: { startsWith: 'anonymised-' } },
      },
    });
  }
}

/** Exported for tests + docs / lint clarity. */
export type { RetentionAuditFinding };
export { ANONYMISED_EMAIL_PATTERN };
