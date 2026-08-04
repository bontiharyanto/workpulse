import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import {
  CUSTOM_REPORT_DIMENSIONS,
  CUSTOM_REPORT_METRICS,
  CUSTOM_REPORT_WINDOWS,
  CustomReportDefinition,
  CustomReportDimension,
  CustomReportMetric,
  metricDescriptor,
} from './domain/custom-report-definition';

export interface CustomReportRow {
  /** Dimension value — day (ISO date), department name, or user email. */
  key: string;
  /** Numeric metric value. */
  value: number;
  /** Optional secondary label (e.g. user fullName for USER dim). */
  label?: string;
}

export interface CustomReportResult {
  definition: CustomReportDefinition;
  rows: CustomReportRow[];
  totalRows: number;
  /** Wall-clock timestamp for the compute — used by the audit trail. */
  computedAt: string;
}

const MAX_ROWS = 5_000;

/**
 * Fase 33b — safe query composer for custom reports.
 *
 * We build queries via **parameterised** `Prisma.sql` fragments only.
 * The domain layer has already restricted `dimension` + `metric` to
 * catalogue values before this method runs; even if it hadn't, every
 * variable passed to `$queryRaw` is properly parameter-bound, so SQL
 * injection is not reachable from the caller.
 *
 * Every result is capped at `MAX_ROWS` — a runaway dimension
 * (e.g. USER on a large tenant) cannot blow past a bounded number of
 * rows even before we render to CSV/XLSX.
 */
@Injectable()
export class ReportBuilderService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    companyId: string,
    definition: CustomReportDefinition,
    now: Date = new Date(),
  ): Promise<CustomReportResult> {
    const rows = await this.dispatch(companyId, definition, now);
    return {
      definition,
      rows,
      totalRows: rows.length,
      computedAt: now.toISOString(),
    };
  }

  private async dispatch(
    companyId: string,
    def: CustomReportDefinition,
    now: Date,
  ): Promise<CustomReportRow[]> {
    const since = new Date(now.getTime() - def.filter.windowDays * 24 * 60 * 60 * 1000);
    const departmentId = def.filter.departmentId;

    switch (def.metric) {
      case 'ATTENDANCE_COUNT':
        return this.attendanceCount(companyId, def.dimension, since, departmentId);
      case 'ATTENDANCE_LATE_COUNT':
        return this.attendanceLateCount(companyId, def.dimension, since, departmentId);
      case 'ATTENDANCE_ON_TIME_RATE':
        return this.attendanceOnTimeRate(companyId, def.dimension, since, departmentId);
      case 'LEAVE_DAYS_APPROVED':
        return this.leaveDaysApproved(companyId, def.dimension, since, departmentId);
      case 'OVERTIME_HOURS':
        return this.overtimeHours(companyId, def.dimension, since, departmentId);
    }
  }

  // ------- Metrics -------

  private async attendanceCount(
    companyId: string,
    dim: CustomReportDimension,
    since: Date,
    departmentId?: string,
  ): Promise<CustomReportRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ key: string; label: string | null; value: bigint }>
    >(this.attendanceSql(companyId, dim, since, departmentId, false));
    return rows.map((r) => ({
      key: r.key,
      label: r.label ?? undefined,
      value: Number(r.value),
    }));
  }

  private async attendanceLateCount(
    companyId: string,
    dim: CustomReportDimension,
    since: Date,
    departmentId?: string,
  ): Promise<CustomReportRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ key: string; label: string | null; value: bigint }>
    >(this.attendanceSql(companyId, dim, since, departmentId, true));
    return rows.map((r) => ({
      key: r.key,
      label: r.label ?? undefined,
      value: Number(r.value),
    }));
  }

  private async attendanceOnTimeRate(
    companyId: string,
    dim: CustomReportDimension,
    since: Date,
    departmentId?: string,
  ): Promise<CustomReportRow[]> {
    // Combine both queries and compute ratio in TS — the SQL surface is
    // narrower and easier to read.
    const [totals, lates] = await Promise.all([
      this.attendanceCount(companyId, dim, since, departmentId),
      this.attendanceLateCount(companyId, dim, since, departmentId),
    ]);
    const lateByKey = new Map(lates.map((r) => [r.key, r.value]));
    return totals.map((t) => {
      const late = lateByKey.get(t.key) ?? 0;
      const rate = t.value === 0 ? 0 : 1 - late / t.value;
      return { key: t.key, label: t.label, value: round4(rate) };
    });
  }

  private async leaveDaysApproved(
    companyId: string,
    dim: CustomReportDimension,
    since: Date,
    departmentId?: string,
  ): Promise<CustomReportRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ key: string; label: string | null; value: number }>
    >(this.leaveSql(companyId, dim, since, departmentId));
    return rows.map((r) => ({
      key: r.key,
      label: r.label ?? undefined,
      value: Number(r.value),
    }));
  }

  private async overtimeHours(
    companyId: string,
    dim: CustomReportDimension,
    since: Date,
    departmentId?: string,
  ): Promise<CustomReportRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ key: string; label: string | null; value: number | null }>
    >(this.overtimeSql(companyId, dim, since, departmentId));
    return rows.map((r) => ({
      key: r.key,
      label: r.label ?? undefined,
      value: round4(Number(r.value ?? 0)),
    }));
  }

  // ------- SQL fragments -------
  // Every reference to `dim`/`departmentId` goes through
  // `Prisma.sql`/`Prisma.join` which properly parameterises values.
  // The `groupExpr` selector is derived from a *closed enum* checked at
  // the domain layer (`validateDefinition`) so we cannot inject a
  // string into the FROM clause.

  private attendanceSql(
    companyId: string,
    dim: CustomReportDimension,
    since: Date,
    departmentId: string | undefined,
    onlyLate: boolean,
  ) {
    const { groupKey, joinUser, groupLabel } = this.dimExpr(dim);
    const lateFilter = onlyLate ? Prisma.sql`AND ar."status" = 'LATE'` : Prisma.empty;
    const deptFilter = departmentId
      ? Prisma.sql`AND u."departmentId" = ${departmentId}`
      : Prisma.empty;
    return Prisma.sql`
      SELECT ${groupKey} AS "key",
             ${groupLabel} AS "label",
             COUNT(*)::bigint AS "value"
      FROM "AttendanceRecord" ar
      ${joinUser}
      WHERE ar."companyId" = ${companyId}
        AND ar."workDate" >= ${since}
        AND ar."deletedAt" IS NULL
        ${lateFilter}
        ${deptFilter}
      GROUP BY ${groupKey}, ${groupLabel}
      ORDER BY ${groupKey} ASC
      LIMIT ${MAX_ROWS}
    `;
  }

  private leaveSql(
    companyId: string,
    dim: CustomReportDimension,
    since: Date,
    departmentId: string | undefined,
  ) {
    const { groupKey, joinUser, groupLabel } = this.dimExpr(dim, 'lr');
    const deptFilter = departmentId
      ? Prisma.sql`AND u."departmentId" = ${departmentId}`
      : Prisma.empty;
    return Prisma.sql`
      SELECT ${groupKey} AS "key",
             ${groupLabel} AS "label",
             SUM(lr."days")::float AS "value"
      FROM "LeaveRequest" lr
      ${joinUser}
      WHERE lr."companyId" = ${companyId}
        AND lr."status" = 'APPROVED'
        AND lr."startDate" >= ${since}
        ${deptFilter}
      GROUP BY ${groupKey}, ${groupLabel}
      ORDER BY ${groupKey} ASC
      LIMIT ${MAX_ROWS}
    `;
  }

  private overtimeSql(
    companyId: string,
    dim: CustomReportDimension,
    since: Date,
    departmentId: string | undefined,
  ) {
    const { groupKey, joinUser, groupLabel } = this.dimExpr(dim, 'ot');
    const deptFilter = departmentId
      ? Prisma.sql`AND u."departmentId" = ${departmentId}`
      : Prisma.empty;
    return Prisma.sql`
      SELECT ${groupKey} AS "key",
             ${groupLabel} AS "label",
             SUM(ot."hours")::float AS "value"
      FROM "OvertimeRequest" ot
      ${joinUser}
      WHERE ot."companyId" = ${companyId}
        AND ot."status" = 'APPROVED'
        AND ot."workDate" >= ${since}
        ${deptFilter}
      GROUP BY ${groupKey}, ${groupLabel}
      ORDER BY ${groupKey} ASC
      LIMIT ${MAX_ROWS}
    `;
  }

  private dimExpr(
    dim: CustomReportDimension,
    tableAlias: 'ar' | 'lr' | 'ot' = 'ar',
  ): {
    groupKey: Prisma.Sql;
    groupLabel: Prisma.Sql;
    joinUser: Prisma.Sql;
  } {
    // Every dimension keyword below is validated against a closed enum
    // upstream, so the branch selector cannot be tampered with.
    switch (dim) {
      case 'DAY': {
        const col =
          tableAlias === 'ar'
            ? Prisma.sql`ar."workDate"`
            : tableAlias === 'lr'
              ? Prisma.sql`lr."startDate"`
              : Prisma.sql`ot."workDate"`;
        return {
          groupKey: Prisma.sql`to_char(${col}, 'YYYY-MM-DD')`,
          groupLabel: Prisma.sql`to_char(${col}, 'YYYY-MM-DD')`,
          joinUser: Prisma.empty,
        };
      }
      case 'USER': {
        const uid =
          tableAlias === 'ar'
            ? Prisma.sql`ar."userId"`
            : tableAlias === 'lr'
              ? Prisma.sql`lr."userId"`
              : Prisma.sql`ot."userId"`;
        return {
          groupKey: Prisma.sql`u."email"`,
          groupLabel: Prisma.sql`u."fullName"`,
          joinUser: Prisma.sql`JOIN "User" u ON u."id" = ${uid}`,
        };
      }
      case 'DEPARTMENT': {
        const uid =
          tableAlias === 'ar'
            ? Prisma.sql`ar."userId"`
            : tableAlias === 'lr'
              ? Prisma.sql`lr."userId"`
              : Prisma.sql`ot."userId"`;
        return {
          groupKey: Prisma.sql`COALESCE(d."name", '(no department)')`,
          groupLabel: Prisma.sql`COALESCE(d."name", '(no department)')`,
          joinUser: Prisma.sql`
            JOIN "User" u ON u."id" = ${uid}
            LEFT JOIN "Department" d ON d."id" = u."departmentId"
          `,
        };
      }
    }
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Small util for the FE / audit — full catalogue in one call. */
export function customReportCatalogue() {
  return {
    dimensions: CUSTOM_REPORT_DIMENSIONS,
    metrics: CUSTOM_REPORT_METRICS,
    windows: CUSTOM_REPORT_WINDOWS,
    metricDescriptors: CUSTOM_REPORT_METRICS.map((m) => metricDescriptor(m)),
  };
}
