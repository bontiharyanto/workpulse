import { Injectable, Logger } from '@nestjs/common';
import { AnalyticsMetricKey, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import {
  Ymd,
  tzDayEndUtc,
  tzDayStartUtc,
  ymdToUtcDateOnly,
} from './domain/period';

/**
 * Fase 33a — pure metric calculators.
 *
 * Each `compute*` method:
 *   * Takes the tenant, the target Y-M-D (calendar day), and the tenant
 *     timezone. NEVER trusts a caller-provided timestamp.
 *   * Reads exclusively from the source-of-truth tables (Attendance,
 *     Leave, Overtime, User) — snapshots are consumers of this layer,
 *     never producers of it.
 *   * Returns a plain number in the metric's native scale (fraction for
 *     ratios, count for integers, IDR whole-rupiah for currency, hours
 *     as Decimal.toNumber() for OT).
 *
 * Kept as a standalone service so both the nightly snapshot worker and
 * the on-the-fly "today" branch of the query layer share the same
 * arithmetic — zero risk of drift between "yesterday from snapshot" and
 * "today from live tables".
 */
@Injectable()
export class AnalyticsComputationService {
  private readonly logger = new Logger(AnalyticsComputationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetch the metric value for `(companyId, day)` — dispatch table
   * keyed on the enum. This is the single entry point both callers
   * (snapshot writer + on-the-fly query) use so the branch coverage
   * stays trivial.
   */
  async compute(
    companyId: string,
    day: Ymd,
    timezone: string,
    key: AnalyticsMetricKey,
  ): Promise<number> {
    switch (key) {
      case AnalyticsMetricKey.ATTENDANCE_ON_TIME_RATE:
        return this.attendanceOnTimeRate(companyId, day);
      case AnalyticsMetricKey.ATTENDANCE_LATE_COUNT:
        return this.attendanceLateCount(companyId, day);
      case AnalyticsMetricKey.ATTENDANCE_ABSENT_COUNT:
        return this.attendanceAbsentCount(companyId, day);
      case AnalyticsMetricKey.LEAVE_PENDING_COUNT:
        return this.leavePendingCount(companyId, day, timezone);
      case AnalyticsMetricKey.LEAVE_DAYS_APPROVED:
        return this.leaveDaysApproved(companyId, day);
      case AnalyticsMetricKey.OVERTIME_HOURS:
        return this.overtimeHours(companyId, day);
      case AnalyticsMetricKey.OVERTIME_COST_IDR:
        return this.overtimeCostIdr(companyId, day);
      case AnalyticsMetricKey.HEADCOUNT_ACTIVE:
        return this.headcountActive(companyId, day, timezone);
      case AnalyticsMetricKey.HEADCOUNT_TERMINATED:
        return this.headcountTerminated(companyId, day, timezone);
    }
  }

  /**
   * Fraction 0..1. Denominator = count of AttendanceRecord rows for the
   * day; numerator = the subset flagged ON_TIME. Days with zero records
   * (weekend, all-hands leave) return 1 so the metric doesn't drag a
   * legitimate 100% average down to 0.
   */
  private async attendanceOnTimeRate(
    companyId: string,
    day: Ymd,
  ): Promise<number> {
    const utcDate = ymdToUtcDateOnly(day);
    const [total, onTime] = await Promise.all([
      this.prisma.attendanceRecord.count({
        where: { companyId, workDate: utcDate, deletedAt: null },
      }),
      this.prisma.attendanceRecord.count({
        where: {
          companyId,
          workDate: utcDate,
          deletedAt: null,
          status: 'ON_TIME',
        },
      }),
    ]);
    if (total === 0) return 1;
    return onTime / total;
  }

  private async attendanceLateCount(
    companyId: string,
    day: Ymd,
  ): Promise<number> {
    return this.prisma.attendanceRecord.count({
      where: {
        companyId,
        workDate: ymdToUtcDateOnly(day),
        deletedAt: null,
        status: 'LATE',
      },
    });
  }

  private async attendanceAbsentCount(
    companyId: string,
    day: Ymd,
  ): Promise<number> {
    return this.prisma.absenceRecord.count({
      where: { companyId, workDate: ymdToUtcDateOnly(day) },
    });
  }

  /**
   * Open-ended snapshot: any LeaveRequest whose status is
   * PENDING_SUPERVISOR or PENDING_HR AND was created on or before the
   * end of the tenant-local `day`. Reflects the queue depth as of
   * midnight-end-of-day.
   */
  private async leavePendingCount(
    companyId: string,
    day: Ymd,
    timezone: string,
  ): Promise<number> {
    return this.prisma.leaveRequest.count({
      where: {
        companyId,
        deletedAt: null,
        status: { in: ['PENDING_SUPERVISOR', 'PENDING_HR'] },
        createdAt: { lt: tzDayEndUtc(day, timezone) },
      },
    });
  }

  /**
   * Approved leave days whose startDate == `day`. Choosing startDate
   * (not any day in `[start, end]`) keeps each request counted exactly
   * once across the timeline.
   */
  private async leaveDaysApproved(
    companyId: string,
    day: Ymd,
  ): Promise<number> {
    const rows = await this.prisma.leaveRequest.aggregate({
      _sum: { days: true },
      where: {
        companyId,
        deletedAt: null,
        status: 'APPROVED',
        startDate: ymdToUtcDateOnly(day),
      },
    });
    return rows._sum.days ?? 0;
  }

  /**
   * Approved or completed OT hours logged with `workDate = day`. Kept
   * in APPROVED-or-COMPLETED (both are "we owe them the pay") so a late
   * completion cron pass doesn't shift the metric between runs.
   */
  private async overtimeHours(companyId: string, day: Ymd): Promise<number> {
    const rows = await this.prisma.overtimeRequest.aggregate({
      _sum: { hours: true },
      where: {
        companyId,
        deletedAt: null,
        workDate: ymdToUtcDateOnly(day),
        status: { in: ['APPROVED', 'COMPLETED'] },
      },
    });
    return this.decimalToNumber(rows._sum.hours);
  }

  private async overtimeCostIdr(companyId: string, day: Ymd): Promise<number> {
    const rows = await this.prisma.overtimeRequest.aggregate({
      _sum: { totalAmount: true },
      where: {
        companyId,
        deletedAt: null,
        workDate: ymdToUtcDateOnly(day),
        status: { in: ['APPROVED', 'COMPLETED'] },
      },
    });
    return this.decimalToNumber(rows._sum.totalAmount);
  }

  /**
   * Headcount = active users at end-of-day. "Active" == `deletedAt` is
   * NULL OR `deletedAt` is strictly after the end-of-day UTC.
   */
  private async headcountActive(
    companyId: string,
    day: Ymd,
    timezone: string,
  ): Promise<number> {
    const endOfDay = tzDayEndUtc(day, timezone);
    return this.prisma.user.count({
      where: {
        companyId,
        AND: [
          { createdAt: { lt: endOfDay } },
          {
            OR: [{ deletedAt: null }, { deletedAt: { gte: endOfDay } }],
          },
        ],
      },
    });
  }

  private async headcountTerminated(
    companyId: string,
    day: Ymd,
    timezone: string,
  ): Promise<number> {
    return this.prisma.user.count({
      where: {
        companyId,
        deletedAt: {
          gte: tzDayStartUtc(day, timezone),
          lt: tzDayEndUtc(day, timezone),
        },
      },
    });
  }

  private decimalToNumber(v: Prisma.Decimal | null | undefined): number {
    if (v == null) return 0;
    // Prisma's Decimal has a `.toNumber()` that clamps to JS float. For
    // Fase 33a values (hours ≤ 24 * 30 * 365, IDR ≤ ~1e12) this is safe.
    return Number(v.toString());
  }
}
