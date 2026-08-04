/**
 * Pure aggregation over attendance records for the "my month at a glance"
 * widget. Kept framework-free so it can be exercised in isolation and reused
 * later for supervisor / HR summary endpoints without any changes.
 *
 * We accept a narrow row shape (`AttendanceSummaryInput`) rather than the
 * full Prisma model so callers can source data from either the DB or a
 * report cache without coupling.
 */

export type AttendanceSummaryStatus = 'ON_TIME' | 'LATE' | 'EARLY_LEAVE' | 'ABSENT' | 'ON_LEAVE';

export interface AttendanceSummaryInput {
  status: AttendanceSummaryStatus;
  clockInAt: Date;
  clockOutAt: Date | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
}

export interface AttendanceMonthlySummary {
  /** Number of rows the aggregation consumed. */
  totalRecords: number;
  /** Distinct calendar days where the user clocked in (regardless of status). */
  presentDays: number;
  onTimeDays: number;
  lateDays: number;
  earlyLeaveDays: number;
  /**
   * Number of canonical `AbsenceRecord` days for this user in the same
   * period. Supplied by the caller (they know the range); zero when the
   * caller doesn't inject an absence count.
   */
  absentDays: number;
  /** Sum of `lateMinutes` across `LATE` rows. */
  totalLateMinutes: number;
  /** Sum of `earlyLeaveMinutes` across `EARLY_LEAVE` rows. */
  totalEarlyLeaveMinutes: number;
  /** Sum of clock-in → clock-out durations, in hours, rounded to 2 decimals. */
  totalHoursWorked: number;
  /** `presentDays > 0` ? `onTimeDays / presentDays` : `null`. Percent 0..100 with 1 decimal. */
  onTimeRatePercent: number | null;
}

/**
 * Summarize a set of records for one user in one calendar month.
 *
 * Rules:
 *   - `ABSENT` and `ON_LEAVE` rows count towards `totalRecords` but NOT
 *     towards `presentDays` or hours worked (nobody actually clocked in).
 *   - A record with `lateMinutes > 0` bumps `lateDays` even if status is
 *     `EARLY_LEAVE` (both conditions can hold).
 *   - Hours worked ignores rows without `clockOutAt` (still working) —
 *     they'd otherwise skew the total artificially.
 */
export interface SummarizeOptions {
  /**
   * Number of canonical AbsenceRecord days for this user in the same
   * period. The domain does NOT compute this itself — callers pass in
   * the count they got from the DB. Absent from `AttendanceRecord`
   * because those records don't exist for absent days.
   */
  absentDaysCount?: number;
}

export function summarizeAttendance(
  rows: AttendanceSummaryInput[],
  options: SummarizeOptions = {},
): AttendanceMonthlySummary {
  let presentDays = 0;
  let onTimeDays = 0;
  let lateDays = 0;
  let earlyLeaveDays = 0;
  let totalLateMinutes = 0;
  let totalEarlyLeaveMinutes = 0;
  let totalHoursWorkedMs = 0;

  for (const r of rows) {
    if (r.status === 'ABSENT' || r.status === 'ON_LEAVE') continue;

    presentDays += 1;

    // A day can be both LATE and EARLY_LEAVE — count both dimensions
    // independently rather than assuming they're mutually exclusive.
    if (r.lateMinutes > 0) {
      lateDays += 1;
      totalLateMinutes += r.lateMinutes;
    } else {
      // Only strictly on-time (0 late minutes AND not early leave) counts
      // toward the "clean attendance" bucket.
      if (r.earlyLeaveMinutes === 0) onTimeDays += 1;
    }
    if (r.earlyLeaveMinutes > 0) {
      earlyLeaveDays += 1;
      totalEarlyLeaveMinutes += r.earlyLeaveMinutes;
    }

    if (r.clockOutAt) {
      totalHoursWorkedMs += r.clockOutAt.getTime() - r.clockInAt.getTime();
    }
  }

  const totalHoursWorked = round2(totalHoursWorkedMs / 3_600_000);
  const onTimeRatePercent =
    presentDays === 0 ? null : Math.round((onTimeDays / presentDays) * 1000) / 10;

  return {
    totalRecords: rows.length,
    presentDays,
    onTimeDays,
    lateDays,
    earlyLeaveDays,
    absentDays: Math.max(0, Math.floor(options.absentDaysCount ?? 0)),
    totalLateMinutes,
    totalEarlyLeaveMinutes,
    totalHoursWorked,
    onTimeRatePercent,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
