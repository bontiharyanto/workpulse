/**
 * Attendance report shaping — pure functions, no I/O, no framework deps.
 *
 * Design: services should call `toAttendanceReportRows` on the raw query result
 * to obtain a normalized, renderer-ready array. Renderers (Excel / PDF) then
 * consume this array without knowing anything about Prisma or Nest.
 */

export type AttendanceReportStatus = 'ON_TIME' | 'LATE' | 'ABSENT' | 'ON_LEAVE';

export interface AttendanceReportRow {
  /** `YYYY-MM-DD` in the company timezone. */
  workDate: string;
  userFullName: string;
  userEmail: string;
  departmentName: string;
  shiftName: string;
  /** HH:mm in the company timezone; empty string when absent/on-leave. */
  clockIn: string;
  clockOut: string;
  /** Decimal hours worked, e.g. 8.5. `null` when clockOut is missing. */
  hoursWorked: number | null;
  status: AttendanceReportStatus;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  note: string;
}

export interface AttendanceRawRecord {
  workDate: Date;
  clockInAt: Date;
  clockOutAt: Date | null;
  status: string; // enum stored as string in Prisma
  lateMinutes: number;
  earlyLeaveMinutes: number;
  note: string | null;
  user: {
    fullName: string;
    email: string;
    department: { name: string } | null;
  };
  shift: { name: string };
}

/**
 * Format a `Date` to `YYYY-MM-DD` for the given IANA timezone. Uses `Intl`
 * to avoid pulling a heavyweight tz lib.
 */
export function formatDateInTz(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '00';
  const d = parts.find((p) => p.type === 'day')?.value ?? '00';
  return `${y}-${m}-${d}`;
}

export function formatTimeInTz(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

/**
 * Compute hours worked, rounded to two decimals. Cross-midnight is handled
 * naturally because we operate on absolute epoch ms.
 */
export function hoursWorked(clockIn: Date, clockOut: Date): number {
  const diffMs = clockOut.getTime() - clockIn.getTime();
  if (diffMs <= 0) return 0;
  return Math.round((diffMs / 3_600_000) * 100) / 100;
}

/**
 * Map raw Prisma records into flat, renderer-ready rows. Timezone parameter is
 * required (report is a business artifact — MUST be in company local time).
 */
export function toAttendanceReportRows(
  raws: ReadonlyArray<AttendanceRawRecord>,
  timezone: string,
): AttendanceReportRow[] {
  return raws.map((r) => ({
    workDate: formatDateInTz(r.workDate, timezone),
    userFullName: r.user.fullName,
    userEmail: r.user.email,
    departmentName: r.user.department?.name ?? '—',
    shiftName: r.shift.name,
    clockIn: formatTimeInTz(r.clockInAt, timezone),
    clockOut: r.clockOutAt ? formatTimeInTz(r.clockOutAt, timezone) : '',
    hoursWorked: r.clockOutAt ? hoursWorked(r.clockInAt, r.clockOutAt) : null,
    status: normalizeStatus(r.status),
    lateMinutes: r.lateMinutes,
    earlyLeaveMinutes: r.earlyLeaveMinutes,
    note: r.note ?? '',
  }));
}

function normalizeStatus(raw: string): AttendanceReportStatus {
  return raw === 'ON_TIME' || raw === 'LATE' || raw === 'ABSENT' || raw === 'ON_LEAVE'
    ? raw
    : 'ON_TIME';
}

// ---- Aggregations (footer / summary) --------------------------------------

export interface AttendanceReportSummary {
  totalRows: number;
  onTime: number;
  late: number;
  absent: number;
  onLeave: number;
  totalHours: number;
  totalLateMinutes: number;
}

export function summarize(rows: ReadonlyArray<AttendanceReportRow>): AttendanceReportSummary {
  let onTime = 0;
  let late = 0;
  let absent = 0;
  let onLeave = 0;
  let totalHours = 0;
  let totalLateMinutes = 0;
  for (const r of rows) {
    if (r.status === 'ON_TIME') onTime++;
    else if (r.status === 'LATE') late++;
    else if (r.status === 'ABSENT') absent++;
    else if (r.status === 'ON_LEAVE') onLeave++;
    totalHours += r.hoursWorked ?? 0;
    totalLateMinutes += r.lateMinutes;
  }
  return {
    totalRows: rows.length,
    onTime,
    late,
    absent,
    onLeave,
    totalHours: Math.round(totalHours * 100) / 100,
    totalLateMinutes,
  };
}
