/**
 * Overtime report shaping — pure functions.
 *
 * Emits one row per `OvertimeRequest`. Enrichment (dayKind from workDate +
 * holidays, ISO date string) happens here so renderers stay pure formatters.
 */

import { classifyDay, type OvertimeDayKind } from '../../overtime/domain/overtime-rate';

export interface OvertimeReportRow {
  userFullName: string;
  userEmail: string;
  departmentName: string;
  workDate: string; // YYYY-MM-DD
  dayKind: OvertimeDayKind;
  hours: number;
  baseRate: number;
  rateMultiplier: number;
  ratePerHour: number;
  totalAmount: number;
  status: string;
  /** ISO 8601. `approvedAt` for APPROVED/COMPLETED, `rejectedAt` for REJECTED, `createdAt` otherwise. */
  decidedAt: string | null;
  reason: string;
}

export interface OvertimeRawRequest {
  workDate: Date;
  hours: { toString: () => string };
  baseRate: { toString: () => string };
  rateMultiplier: { toString: () => string };
  ratePerHour: { toString: () => string };
  totalAmount: { toString: () => string };
  status: string;
  reason: string;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  createdAt: Date;
  user: {
    fullName: string;
    email: string;
    department: { name: string } | null;
  };
}

/**
 * Convert raw Prisma rows into presentation rows. `holidaySet` MUST contain
 * the union of `Holiday.date` (in ISO `YYYY-MM-DD`) that overlap the window.
 */
export function toOvertimeReportRows(
  raws: ReadonlyArray<OvertimeRawRequest>,
  holidaySet: ReadonlySet<string>,
): OvertimeReportRow[] {
  return raws.map((r) => {
    const dayKind = classifyDay(r.workDate, holidaySet);
    return {
      userFullName: r.user.fullName,
      userEmail: r.user.email,
      departmentName: r.user.department?.name ?? '—',
      workDate: toIsoDate(r.workDate),
      dayKind,
      hours: toNumber(r.hours),
      baseRate: toNumber(r.baseRate),
      rateMultiplier: toNumber(r.rateMultiplier),
      ratePerHour: toNumber(r.ratePerHour),
      totalAmount: toNumber(r.totalAmount),
      status: r.status,
      decidedAt: pickDecidedAt(r),
      reason: r.reason,
    };
  });
}

export interface OvertimeReportTotals {
  requestCount: number;
  users: number;
  totalHours: number;
  totalAmount: number;
  /** Hours breakdown by dayKind (denormalized for at-a-glance payroll audits). */
  hoursByDayKind: Record<OvertimeDayKind, number>;
  amountByDayKind: Record<OvertimeDayKind, number>;
}

export function summarizeOvertime(rows: ReadonlyArray<OvertimeReportRow>): OvertimeReportTotals {
  const seenUsers = new Set<string>();
  const hoursByDayKind: Record<OvertimeDayKind, number> = {
    WEEKDAY: 0,
    WEEKEND: 0,
    HOLIDAY: 0,
  };
  const amountByDayKind: Record<OvertimeDayKind, number> = {
    WEEKDAY: 0,
    WEEKEND: 0,
    HOLIDAY: 0,
  };
  let totalHours = 0;
  let totalAmount = 0;
  for (const r of rows) {
    seenUsers.add(r.userEmail);
    totalHours += r.hours;
    totalAmount += r.totalAmount;
    hoursByDayKind[r.dayKind] += r.hours;
    amountByDayKind[r.dayKind] += r.totalAmount;
  }
  return {
    requestCount: rows.length,
    users: seenUsers.size,
    // Guard against binary-float drift accumulating across many rows.
    totalHours: round2(totalHours),
    totalAmount: round2(totalAmount),
    hoursByDayKind: {
      WEEKDAY: round2(hoursByDayKind.WEEKDAY),
      WEEKEND: round2(hoursByDayKind.WEEKEND),
      HOLIDAY: round2(hoursByDayKind.HOLIDAY),
    },
    amountByDayKind: {
      WEEKDAY: round2(amountByDayKind.WEEKDAY),
      WEEKEND: round2(amountByDayKind.WEEKEND),
      HOLIDAY: round2(amountByDayKind.HOLIDAY),
    },
  };
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toNumber(v: { toString: () => string }): number {
  return Number(v.toString());
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pickDecidedAt(r: OvertimeRawRequest): string | null {
  if (r.status === 'APPROVED' || r.status === 'COMPLETED') {
    return r.approvedAt ? r.approvedAt.toISOString() : null;
  }
  if (r.status === 'REJECTED') {
    return r.rejectedAt ? r.rejectedAt.toISOString() : null;
  }
  return null;
}
