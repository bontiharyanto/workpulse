/**
 * Pure builder that shapes payroll-facing rows for the export.
 *
 * Kept in the domain layer (no Prisma types) so:
 *   - Unit tests can lock the column order + formatting deterministically.
 *   - Downstream renderers (CSV, XLSX, future JSON API) share one shape.
 *   - A future locale/timezone swap doesn't fan out across renderers.
 *
 * "Summary" = one row per user × period (the rollup).
 * "Detail"  = one row per user × period × workDate (each `TimesheetEntry`).
 */

export type PayrollColumnKey =
  // Identity
  | 'employeeId'
  | 'employeeCode'
  | 'employeeName'
  | 'employeeEmail'
  | 'departmentName'
  // Period
  | 'periodLabel'
  | 'periodStart'
  | 'periodEnd'
  // Rollup (SUMMARY)
  | 'workingDays'
  | 'regularHours'
  | 'overtimeHours'
  | 'leaveDays'
  | 'absentDays'
  | 'holidays'
  | 'lateMinutes'
  | 'earlyLeaveMinutes'
  | 'overtimeHourlyRate'
  | 'overtimePayEstimate'
  // Detail (DETAIL only)
  | 'workDate'
  | 'entryKind'
  | 'expectedHours'
  | 'entryRegularHours'
  | 'entryOvertimeHours'
  | 'entryLeaveHours'
  | 'entryLateMinutes'
  | 'entryEarlyLeaveMinutes'
  | 'entryNote';

export interface PayrollColumn {
  key: PayrollColumnKey;
  header: string;
  /** Excel column width; used by XLSX renderer, ignored by CSV. */
  width: number;
  /** `'number'` cells are right-aligned in Excel; CSV is agnostic. */
  numeric?: boolean;
}

/**
 * Frozen column order — never reorder without bumping ADR-0025.
 * External payroll systems parse by column index in the CSV variant.
 */
export const SUMMARY_COLUMNS: readonly PayrollColumn[] = Object.freeze([
  { key: 'employeeId', header: 'employee_id', width: 30 },
  { key: 'employeeName', header: 'employee_name', width: 26 },
  { key: 'employeeEmail', header: 'employee_email', width: 28 },
  { key: 'departmentName', header: 'department', width: 20 },
  { key: 'periodLabel', header: 'period_label', width: 18 },
  { key: 'periodStart', header: 'period_start', width: 12 },
  { key: 'periodEnd', header: 'period_end', width: 12 },
  { key: 'workingDays', header: 'working_days', width: 12, numeric: true },
  { key: 'regularHours', header: 'regular_hours', width: 12, numeric: true },
  { key: 'overtimeHours', header: 'overtime_hours', width: 14, numeric: true },
  { key: 'leaveDays', header: 'leave_days', width: 11, numeric: true },
  { key: 'absentDays', header: 'absent_days', width: 11, numeric: true },
  { key: 'holidays', header: 'holidays', width: 9, numeric: true },
  { key: 'lateMinutes', header: 'late_minutes', width: 13, numeric: true },
  {
    key: 'earlyLeaveMinutes',
    header: 'early_leave_minutes',
    width: 20,
    numeric: true,
  },
  {
    key: 'overtimeHourlyRate',
    header: 'overtime_hourly_rate',
    width: 20,
    numeric: true,
  },
  {
    key: 'overtimePayEstimate',
    header: 'overtime_pay_estimate',
    width: 22,
    numeric: true,
  },
]);

export const DETAIL_COLUMNS: readonly PayrollColumn[] = Object.freeze([
  { key: 'employeeId', header: 'employee_id', width: 30 },
  { key: 'employeeName', header: 'employee_name', width: 26 },
  { key: 'employeeEmail', header: 'employee_email', width: 28 },
  { key: 'departmentName', header: 'department', width: 20 },
  { key: 'periodLabel', header: 'period_label', width: 18 },
  { key: 'workDate', header: 'work_date', width: 12 },
  { key: 'entryKind', header: 'entry_kind', width: 12 },
  { key: 'expectedHours', header: 'expected_hours', width: 14, numeric: true },
  {
    key: 'entryRegularHours',
    header: 'regular_hours',
    width: 12,
    numeric: true,
  },
  {
    key: 'entryOvertimeHours',
    header: 'overtime_hours',
    width: 14,
    numeric: true,
  },
  {
    key: 'entryLeaveHours',
    header: 'leave_hours',
    width: 11,
    numeric: true,
  },
  {
    key: 'entryLateMinutes',
    header: 'late_minutes',
    width: 13,
    numeric: true,
  },
  {
    key: 'entryEarlyLeaveMinutes',
    header: 'early_leave_minutes',
    width: 20,
    numeric: true,
  },
  { key: 'entryNote', header: 'note', width: 40 },
]);

// ---------------------------------------------------------------------------
// Row inputs — mirror what the service loads. Kept minimal so tests don't
// need to fabricate full Prisma models.
// ---------------------------------------------------------------------------

export interface PayrollSourceTimesheet {
  userId: string;
  userFullName: string;
  userEmail: string;
  departmentName: string | null;
  overtimeHourlyRate: number | null;
  periodLabel: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;
  totals: {
    workingDays: number;
    regularHours: number;
    overtimeHours: number;
    leaveDays: number;
    absentDays: number;
    holidays: number;
    lateMinutes: number;
    earlyLeaveMinutes: number;
  };
  entries: ReadonlyArray<{
    workDate: string;
    kind: string;
    expectedHours: number | null;
    regularHours: number;
    overtimeHours: number;
    leaveHours: number;
    lateMinutes: number;
    earlyLeaveMinutes: number;
    note: string | null;
  }>;
}

export type PayrollCellValue = string | number | null;

export type PayrollRow = Record<PayrollColumnKey, PayrollCellValue>;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function buildSummaryRow(ts: PayrollSourceTimesheet): PayrollRow {
  const rate = ts.overtimeHourlyRate ?? 0;
  const payEstimate = round2(ts.totals.overtimeHours * rate);
  return {
    employeeId: ts.userId,
    employeeCode: null, // reserved for a future `User.employeeCode` column
    employeeName: ts.userFullName,
    employeeEmail: ts.userEmail,
    departmentName: ts.departmentName,
    periodLabel: ts.periodLabel,
    periodStart: ts.periodStart,
    periodEnd: ts.periodEnd,
    workingDays: ts.totals.workingDays,
    regularHours: round2(ts.totals.regularHours),
    overtimeHours: round2(ts.totals.overtimeHours),
    leaveDays: ts.totals.leaveDays,
    absentDays: ts.totals.absentDays,
    holidays: ts.totals.holidays,
    lateMinutes: ts.totals.lateMinutes,
    earlyLeaveMinutes: ts.totals.earlyLeaveMinutes,
    overtimeHourlyRate: ts.overtimeHourlyRate,
    overtimePayEstimate: payEstimate,
    // Detail-only fields → null so the summary renderer skips them.
    workDate: null,
    entryKind: null,
    expectedHours: null,
    entryRegularHours: null,
    entryOvertimeHours: null,
    entryLeaveHours: null,
    entryLateMinutes: null,
    entryEarlyLeaveMinutes: null,
    entryNote: null,
  };
}

export function buildDetailRows(ts: PayrollSourceTimesheet): PayrollRow[] {
  return ts.entries.map((e) => ({
    employeeId: ts.userId,
    employeeCode: null,
    employeeName: ts.userFullName,
    employeeEmail: ts.userEmail,
    departmentName: ts.departmentName,
    periodLabel: ts.periodLabel,
    periodStart: ts.periodStart,
    periodEnd: ts.periodEnd,
    workingDays: null,
    regularHours: null,
    overtimeHours: null,
    leaveDays: null,
    absentDays: null,
    holidays: null,
    lateMinutes: null,
    earlyLeaveMinutes: null,
    overtimeHourlyRate: null,
    overtimePayEstimate: null,
    workDate: e.workDate,
    entryKind: e.kind,
    expectedHours: e.expectedHours,
    entryRegularHours: round2(e.regularHours),
    entryOvertimeHours: round2(e.overtimeHours),
    entryLeaveHours: round2(e.leaveHours),
    entryLateMinutes: e.lateMinutes,
    entryEarlyLeaveMinutes: e.earlyLeaveMinutes,
    entryNote: e.note,
  }));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
