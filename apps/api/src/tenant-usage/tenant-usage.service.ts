import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma, TenantUsageSnapshot } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import {
  computeDbRowsTotal,
  computeStorageTotal,
  previousUtcMonth,
  utcMonthRange,
} from './domain/usage-calculator';

interface ListOpts {
  companyId?: string;
  page?: number;
  pageSize?: number;
}

/**
 * OPS-7 — Tenant usage snapshot service.
 *
 * Monthly per-tenant footprint: storage, DB row counts, notification
 * volume, webhook deliveries, active + total users. Basis for future
 * billing tier and ops capacity planning.
 *
 * Design notes:
 *   - Storage bytes counted from DB (`TimesheetExport.bytes` +
 *     `DataExportRequest.fileSize`). Attachment file sizes are NOT
 *     tracked yet — the snapshot flags `attachmentBytesTracked=false`
 *     so consumers know the total is an under-estimate. Post-Beta will
 *     introduce a dedicated `Attachment` model with `contentLength`.
 *   - DB row counts are point-in-time at snapshot generation, not
 *     period-scoped. They tell you "how big is this tenant NOW" —
 *     which is what matters for capacity planning.
 *   - Emails / webhooks / active users are period-scoped, so they tell
 *     you "how much activity did we see LAST MONTH".
 *   - The `activeUsers` metric is a proxy: distinct `userId` on any
 *     `Attendance`, `LeaveRequest`, `OvertimeRequest`, or `AuditLog`
 *     row during the period. Cheaper than tracking real logins.
 */
@Injectable()
export class TenantUsageService {
  private readonly logger = new Logger(TenantUsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Write path
  // ---------------------------------------------------------------------------

  async snapshotForPeriod(
    companyId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<TenantUsageSnapshot> {
    if (periodEnd <= periodStart) {
      throw new BadRequestException('USAGE_PERIOD_INVALID');
    }

    const [storage, dbRows, notificationsCreated, webhookDeliveries, users] = await Promise.all([
      this.collectStorage(companyId, periodStart, periodEnd),
      this.collectDbRows(companyId),
      this.collectNotifications(companyId, periodStart, periodEnd),
      this.collectWebhookDeliveries(companyId, periodStart, periodEnd),
      this.collectUsers(companyId, periodStart, periodEnd),
    ]);

    const dbRowsTotal = computeDbRowsTotal(dbRows);
    const storageTotalBytes = computeStorageTotal(storage);

    const row = await this.prisma.tenantUsageSnapshot.upsert({
      where: {
        one_snapshot_per_tenant_per_period: {
          companyId,
          periodStart,
        },
      },
      create: {
        companyId,
        periodStart,
        periodEnd,
        storageExportBytes: storage.exportBytes,
        storageDsarBytes: storage.dsarBytes,
        storageTotalBytes,
        attachmentBytesTracked: false,
        dbRowsUser: dbRows.user,
        dbRowsAttendance: dbRows.attendance,
        dbRowsLeave: dbRows.leave,
        dbRowsOvertime: dbRows.overtime,
        dbRowsTimesheetEntry: dbRows.timesheetEntry,
        dbRowsAuditLog: dbRows.auditLog,
        dbRowsNotification: dbRows.notification,
        dbRowsTimesheetExport: dbRows.timesheetExport,
        dbRowsWebhookDelivery: dbRows.webhookDelivery,
        dbRowsTotal,
        notificationsCreated,
        webhookDeliveries,
        activeUsers: users.active,
        totalUsers: users.total,
      },
      update: {
        periodEnd,
        generatedAt: new Date(),
        storageExportBytes: storage.exportBytes,
        storageDsarBytes: storage.dsarBytes,
        storageTotalBytes,
        dbRowsUser: dbRows.user,
        dbRowsAttendance: dbRows.attendance,
        dbRowsLeave: dbRows.leave,
        dbRowsOvertime: dbRows.overtime,
        dbRowsTimesheetEntry: dbRows.timesheetEntry,
        dbRowsAuditLog: dbRows.auditLog,
        dbRowsNotification: dbRows.notification,
        dbRowsTimesheetExport: dbRows.timesheetExport,
        dbRowsWebhookDelivery: dbRows.webhookDelivery,
        dbRowsTotal,
        notificationsCreated,
        webhookDeliveries,
        activeUsers: users.active,
        totalUsers: users.total,
      },
    });

    this.logger.log(
      `tenant usage snapshot companyId=${companyId} period=${periodStart.toISOString()} totalBytes=${storageTotalBytes} rows=${dbRowsTotal} activeUsers=${users.active}`,
    );
    return row;
  }

  async snapshotPreviousMonth(
    companyId: string,
    reference = new Date(),
  ): Promise<TenantUsageSnapshot> {
    const { periodStart, periodEnd } = previousUtcMonth(reference);
    return this.snapshotForPeriod(companyId, periodStart, periodEnd);
  }

  async regenerateMonth(
    companyId: string,
    year: number,
    monthIndex1To12: number,
  ): Promise<TenantUsageSnapshot> {
    const { periodStart, periodEnd } = utcMonthRange(year, monthIndex1To12);
    return this.snapshotForPeriod(companyId, periodStart, periodEnd);
  }

  // ---------------------------------------------------------------------------
  // Read path
  // ---------------------------------------------------------------------------

  /**
   * Cross-tenant listing (SUPER_ADMIN) — accepts an optional `companyId`
   * filter for per-tenant HR usage.
   */
  async list(opts: ListOpts = {}): Promise<{
    rows: TenantUsageSnapshot[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 24));
    const where: Prisma.TenantUsageSnapshotWhereInput = {
      ...(opts.companyId ? { companyId: opts.companyId } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.tenantUsageSnapshot.findMany({
        where,
        orderBy: [{ periodStart: 'desc' }, { companyId: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.tenantUsageSnapshot.count({ where }),
    ]);
    return { rows, total, page, pageSize };
  }

  async detail(companyId: string | null, snapshotId: string): Promise<TenantUsageSnapshot> {
    const row = await this.prisma.tenantUsageSnapshot.findFirst({
      where: {
        id: snapshotId,
        // `companyId=null` means SUPER_ADMIN — no scoping filter.
        ...(companyId ? { companyId } : {}),
      },
    });
    if (!row) throw new NotFoundException('TENANT_USAGE_SNAPSHOT_NOT_FOUND');
    return row;
  }

  async latestForCompany(companyId: string): Promise<TenantUsageSnapshot | null> {
    return this.prisma.tenantUsageSnapshot.findFirst({
      where: { companyId },
      orderBy: { periodStart: 'desc' },
    });
  }

  // ---------------------------------------------------------------------------
  // Collectors
  // ---------------------------------------------------------------------------

  private async collectStorage(
    companyId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{ exportBytes: bigint; dsarBytes: bigint }> {
    // Sum `TimesheetExport.bytes` for exports committed during the
    // period. `bytes` is an `Int` in Prisma — cast up to BigInt as we
    // accumulate to avoid a 32-bit overflow on large tenants.
    const exportAgg = await this.prisma.timesheetExport.aggregate({
      where: {
        companyId,
        createdAt: { gte: periodStart, lt: periodEnd },
      },
      _sum: { bytes: true },
    });
    const dsarAgg = await this.prisma.dataExportRequest.aggregate({
      where: {
        companyId,
        completedAt: { gte: periodStart, lt: periodEnd },
        fileSize: { not: null },
      },
      _sum: { fileSize: true },
    });
    return {
      exportBytes: BigInt(exportAgg._sum.bytes ?? 0),
      dsarBytes: BigInt(dsarAgg._sum.fileSize ?? 0),
    };
  }

  private async collectDbRows(companyId: string): Promise<{
    user: number;
    attendance: number;
    leave: number;
    overtime: number;
    timesheetEntry: number;
    auditLog: number;
    notification: number;
    timesheetExport: number;
    webhookDelivery: number;
  }> {
    const [
      user,
      attendance,
      leave,
      overtime,
      timesheetEntry,
      auditLog,
      notification,
      timesheetExport,
      webhookDelivery,
    ] = await Promise.all([
      this.prisma.user.count({ where: { companyId, deletedAt: null } }),
      this.prisma.attendanceRecord.count({ where: { companyId } }),
      this.prisma.leaveRequest.count({ where: { companyId } }),
      this.prisma.overtimeRequest.count({ where: { companyId } }),
      this.prisma.timesheetEntry.count({
        where: { timesheet: { companyId } },
      }),
      this.prisma.auditLog.count({ where: { companyId } }),
      this.prisma.notification.count({ where: { companyId } }),
      this.prisma.timesheetExport.count({ where: { companyId } }),
      this.prisma.webhookDelivery.count({ where: { companyId } }),
    ]);
    return {
      user,
      attendance,
      leave,
      overtime,
      timesheetEntry,
      auditLog,
      notification,
      timesheetExport,
      webhookDelivery,
    };
  }

  private async collectNotifications(
    companyId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<number> {
    return this.prisma.notification.count({
      where: {
        companyId,
        createdAt: { gte: periodStart, lt: periodEnd },
      },
    });
  }

  private async collectWebhookDeliveries(
    companyId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<number> {
    return this.prisma.webhookDelivery.count({
      where: {
        companyId,
        createdAt: { gte: periodStart, lt: periodEnd },
      },
    });
  }

  private async collectUsers(
    companyId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{ active: number; total: number }> {
    const total = await this.prisma.user.count({
      where: { companyId, deletedAt: null },
    });

    // Active = distinct userId across attendance / leave / overtime /
    // audit within the period. `distinct` on `count` is not directly
    // supported by Prisma; we use `findMany` with `distinct` and count
    // the returned length. Bounded by `total` so no unbounded scan.
    const distinctIds = new Set<string>();
    const addRows = async <T extends { userId?: string | null; actorId?: string | null }>(
      rows: T[],
      key: 'userId' | 'actorId',
    ): Promise<void> => {
      for (const r of rows) {
        const v = r[key];
        if (typeof v === 'string') distinctIds.add(v);
      }
    };

    const [att, leaves, ots, audits] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: {
          companyId,
          clockInAt: { gte: periodStart, lt: periodEnd },
        },
        select: { userId: true },
        distinct: ['userId'],
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          companyId,
          createdAt: { gte: periodStart, lt: periodEnd },
        },
        select: { userId: true },
        distinct: ['userId'],
      }),
      this.prisma.overtimeRequest.findMany({
        where: {
          companyId,
          createdAt: { gte: periodStart, lt: periodEnd },
        },
        select: { userId: true },
        distinct: ['userId'],
      }),
      this.prisma.auditLog.findMany({
        where: {
          companyId,
          createdAt: { gte: periodStart, lt: periodEnd },
          actorId: { not: null },
        },
        select: { actorId: true },
        distinct: ['actorId'],
      }),
    ]);
    await addRows(att, 'userId');
    await addRows(leaves, 'userId');
    await addRows(ots, 'userId');
    await addRows(audits, 'actorId');

    return { active: distinctIds.size, total };
  }
}
