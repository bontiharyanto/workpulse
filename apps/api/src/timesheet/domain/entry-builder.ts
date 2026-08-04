import { TimesheetEntryKind } from '@prisma/client';

/**
 * Narrow view of an AttendanceRecord row consumed by the entry-builder.
 * `hoursWorked` is derived by the caller (clockOut - clockIn - break)
 * so this domain module has zero opinion on break policy.
 */
export interface AttendanceInput {
  workDate: string; // "YYYY-MM-DD" in tenant tz
  clockInAt: Date | null;
  clockOutAt: Date | null;
  hoursWorked: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  attendanceId: string;
}

export interface OvertimeInput {
  workDate: string;
  hours: number;
  overtimeId: string;
}

export interface LeaveDayInput {
  workDate: string; // one row per calendar day covered by a leave request
  leaveTypeName: string;
  hours: number;
  leaveId: string;
}

export interface AbsenceInput {
  workDate: string;
  absenceId: string;
  reason: string | null;
}

export interface HolidayInput {
  workDate: string;
  name: string;
  holidayId: string;
}

export interface ShiftAssignmentInput {
  /** Working hours per day expected by the shift on that weekday. */
  hoursPerWorkingDay: number;
  /**
   * Set of weekday numbers (0=Sun..6=Sat) considered working days by
   * this assignment. Empty set → the user has no scheduled work.
   */
  workingWeekdays: ReadonlySet<number>;
}

export interface BuildEntryInput {
  workDate: string; // "YYYY-MM-DD" in tenant tz
  weekday: number; // 0..6 in tenant tz
  shift: ShiftAssignmentInput | null;
  attendance: AttendanceInput | null;
  overtimes: OvertimeInput[];
  leaveDay: LeaveDayInput | null;
  absence: AbsenceInput | null;
  holiday: HolidayInput | null;
}

export interface BuiltEntry {
  workDate: string;
  kind: TimesheetEntryKind;
  expectedHours: number | null;
  regularHours: number;
  overtimeHours: number;
  leaveHours: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  sourceRefs: Record<string, string>;
  note: string | null;
}

/**
 * Pure — pick the winning kind for a workDate and freeze the sources
 * that fed it. Conflict resolution:
 *
 *   1. HOLIDAY overrides everything (nobody is expected to work).
 *   2. LEAVE (any type) overrides attendance / absence / weekend —
 *      an approved leave supersedes a stray clock-in.
 *   3. ABSENT overrides attendance only when the user has no clock-in
 *      for the day (auto-scanner is supposed to skip anyone who
 *      punched in).
 *   4. WEEKEND when the day is outside `shift.workingWeekdays` AND
 *      there's no attendance / OT.
 *   5. Otherwise WORKING.
 *
 * Overtime hours are ALWAYS credited on top — an OT approved on a
 * holiday still counts as overtime for payroll.
 */
export function buildEntry(input: BuildEntryInput): BuiltEntry {
  const expectedHours =
    input.shift && input.shift.workingWeekdays.has(input.weekday)
      ? input.shift.hoursPerWorkingDay
      : 0;

  const overtimeHours = input.overtimes.reduce((acc, ot) => acc + ot.hours, 0);
  const overtimeIds = input.overtimes.map((ot) => ot.overtimeId);
  const sourceRefs: Record<string, string> = {};

  if (overtimeIds.length === 1) {
    sourceRefs.overtimeId = overtimeIds[0]!;
  } else if (overtimeIds.length > 1) {
    // Multiple OT requests on the same day is legal (e.g. two
    // separate justifications). Serialise as a comma-list — we're
    // never joining on this so JSON-array vs string is moot.
    sourceRefs.overtimeIds = overtimeIds.join(',');
  }

  if (input.holiday) {
    sourceRefs.holidayId = input.holiday.holidayId;
    return {
      workDate: input.workDate,
      kind: TimesheetEntryKind.HOLIDAY,
      expectedHours: expectedHours || null,
      regularHours: 0,
      overtimeHours,
      leaveHours: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      sourceRefs,
      note: input.holiday.name,
    };
  }

  if (input.leaveDay) {
    sourceRefs.leaveId = input.leaveDay.leaveId;
    return {
      workDate: input.workDate,
      kind: TimesheetEntryKind.LEAVE,
      expectedHours: expectedHours || null,
      regularHours: 0,
      overtimeHours,
      leaveHours: input.leaveDay.hours,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      sourceRefs,
      note: input.leaveDay.leaveTypeName,
    };
  }

  if (input.attendance) {
    sourceRefs.attendanceId = input.attendance.attendanceId;
    return {
      workDate: input.workDate,
      kind: TimesheetEntryKind.WORKING,
      expectedHours: expectedHours || null,
      regularHours: input.attendance.hoursWorked,
      overtimeHours,
      leaveHours: 0,
      lateMinutes: input.attendance.lateMinutes,
      earlyLeaveMinutes: input.attendance.earlyLeaveMinutes,
      sourceRefs,
      note: describeAttendanceNote(input.attendance),
    };
  }

  if (input.absence) {
    sourceRefs.absenceId = input.absence.absenceId;
    return {
      workDate: input.workDate,
      kind: TimesheetEntryKind.ABSENT,
      expectedHours: expectedHours || null,
      regularHours: 0,
      overtimeHours,
      leaveHours: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      sourceRefs,
      note: input.absence.reason ?? 'Absent',
    };
  }

  const isWorkingDay = input.shift?.workingWeekdays.has(input.weekday) ?? false;
  if (!isWorkingDay) {
    return {
      workDate: input.workDate,
      kind: TimesheetEntryKind.WEEKEND,
      expectedHours: null,
      regularHours: 0,
      overtimeHours,
      leaveHours: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      sourceRefs,
      note: null,
    };
  }

  // Working day, but no attendance / leave / absence / holiday. Only
  // reachable when the auto-absence-scanner hasn't run yet — leave the
  // row blank and let the next generate pass fix it up.
  return {
    workDate: input.workDate,
    kind: TimesheetEntryKind.WORKING,
    expectedHours: expectedHours || null,
    regularHours: 0,
    overtimeHours,
    leaveHours: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    sourceRefs,
    note: null,
  };
}

function describeAttendanceNote(a: AttendanceInput): string | null {
  if (a.lateMinutes > 0 && a.earlyLeaveMinutes > 0) {
    return `Late ${a.lateMinutes}m + Left early ${a.earlyLeaveMinutes}m`;
  }
  if (a.lateMinutes > 0) return `Late ${a.lateMinutes}m`;
  if (a.earlyLeaveMinutes > 0) return `Left early ${a.earlyLeaveMinutes}m`;
  return null;
}

/**
 * Roll up daily entries into the Timesheet header.
 */
export function rollupTimesheet(entries: BuiltEntry[]): {
  totalRegularHours: number;
  totalOvertimeHours: number;
  totalLeaveDays: number;
  totalAbsentDays: number;
  totalHolidays: number;
  totalWorkingDays: number;
  totalLateMinutes: number;
  totalEarlyLeaveMinutes: number;
} {
  const acc = {
    totalRegularHours: 0,
    totalOvertimeHours: 0,
    totalLeaveDays: 0,
    totalAbsentDays: 0,
    totalHolidays: 0,
    totalWorkingDays: 0,
    totalLateMinutes: 0,
    totalEarlyLeaveMinutes: 0,
  };
  for (const e of entries) {
    acc.totalRegularHours += e.regularHours;
    acc.totalOvertimeHours += e.overtimeHours;
    acc.totalLateMinutes += e.lateMinutes;
    acc.totalEarlyLeaveMinutes += e.earlyLeaveMinutes;
    switch (e.kind) {
      case TimesheetEntryKind.LEAVE:
        acc.totalLeaveDays += 1;
        break;
      case TimesheetEntryKind.ABSENT:
        acc.totalAbsentDays += 1;
        break;
      case TimesheetEntryKind.HOLIDAY:
        acc.totalHolidays += 1;
        break;
      case TimesheetEntryKind.WORKING:
        acc.totalWorkingDays += 1;
        break;
      case TimesheetEntryKind.WEEKEND:
        // Off-work day — no contribution.
        break;
      default: {
        const exhaustive: never = e.kind;
        throw new Error(`unhandled kind: ${String(exhaustive)}`);
      }
    }
  }
  // Round to 2 decimals to avoid floating-point noise in DB writes.
  acc.totalRegularHours = round2(acc.totalRegularHours);
  acc.totalOvertimeHours = round2(acc.totalOvertimeHours);
  return acc;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
