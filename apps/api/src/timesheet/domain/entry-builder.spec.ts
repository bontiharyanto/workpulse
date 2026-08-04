import { TimesheetEntryKind } from '@prisma/client';

import {
  buildEntry,
  rollupTimesheet,
  type BuildEntryInput,
} from './entry-builder';

function baseInput(overrides: Partial<BuildEntryInput> = {}): BuildEntryInput {
  return {
    workDate: '2026-08-05',
    weekday: 3, // Wed
    shift: {
      hoursPerWorkingDay: 8,
      workingWeekdays: new Set([1, 2, 3, 4, 5]),
    },
    attendance: null,
    overtimes: [],
    leaveDay: null,
    absence: null,
    holiday: null,
    ...overrides,
  };
}

describe('buildEntry — precedence', () => {
  it('holiday wins over attendance, leave, and absence', () => {
    const e = buildEntry(
      baseInput({
        attendance: {
          workDate: '2026-08-05',
          clockInAt: new Date(),
          clockOutAt: new Date(),
          hoursWorked: 8,
          lateMinutes: 0,
          earlyLeaveMinutes: 0,
          attendanceId: 'A1',
        },
        leaveDay: {
          workDate: '2026-08-05',
          leaveTypeName: 'Cuti Tahunan',
          hours: 8,
          leaveId: 'L1',
        },
        holiday: {
          workDate: '2026-08-05',
          name: 'Hari Kemerdekaan',
          holidayId: 'H1',
        },
      }),
    );
    expect(e.kind).toBe(TimesheetEntryKind.HOLIDAY);
    expect(e.regularHours).toBe(0);
    expect(e.leaveHours).toBe(0);
    expect(e.note).toBe('Hari Kemerdekaan');
    expect(e.sourceRefs.holidayId).toBe('H1');
  });

  it('leave wins over attendance and absence when no holiday', () => {
    const e = buildEntry(
      baseInput({
        attendance: {
          workDate: '2026-08-05',
          clockInAt: new Date(),
          clockOutAt: new Date(),
          hoursWorked: 8,
          lateMinutes: 12,
          earlyLeaveMinutes: 0,
          attendanceId: 'A1',
        },
        leaveDay: {
          workDate: '2026-08-05',
          leaveTypeName: 'Cuti Sakit',
          hours: 8,
          leaveId: 'L1',
        },
      }),
    );
    expect(e.kind).toBe(TimesheetEntryKind.LEAVE);
    expect(e.leaveHours).toBe(8);
    expect(e.regularHours).toBe(0);
    expect(e.lateMinutes).toBe(0);
    expect(e.note).toBe('Cuti Sakit');
  });

  it('attendance wins over absence', () => {
    const e = buildEntry(
      baseInput({
        attendance: {
          workDate: '2026-08-05',
          clockInAt: new Date(),
          clockOutAt: new Date(),
          hoursWorked: 7.5,
          lateMinutes: 0,
          earlyLeaveMinutes: 30,
          attendanceId: 'A1',
        },
        absence: {
          workDate: '2026-08-05',
          absenceId: 'AB1',
          reason: 'No punch',
        },
      }),
    );
    expect(e.kind).toBe(TimesheetEntryKind.WORKING);
    expect(e.regularHours).toBe(7.5);
    expect(e.earlyLeaveMinutes).toBe(30);
    expect(e.note).toBe('Left early 30m');
  });

  it('overtime is added on top even on holidays', () => {
    const e = buildEntry(
      baseInput({
        overtimes: [
          {
            workDate: '2026-08-05',
            hours: 3,
            overtimeId: 'O1',
          },
        ],
        holiday: {
          workDate: '2026-08-05',
          name: 'Test Holiday',
          holidayId: 'H1',
        },
      }),
    );
    expect(e.kind).toBe(TimesheetEntryKind.HOLIDAY);
    expect(e.overtimeHours).toBe(3);
    expect(e.sourceRefs.overtimeId).toBe('O1');
  });

  it('two overtimes on the same day are combined into overtimeIds', () => {
    const e = buildEntry(
      baseInput({
        overtimes: [
          { workDate: '2026-08-05', hours: 2, overtimeId: 'O1' },
          { workDate: '2026-08-05', hours: 1, overtimeId: 'O2' },
        ],
      }),
    );
    expect(e.overtimeHours).toBe(3);
    expect(e.sourceRefs.overtimeIds).toBe('O1,O2');
    expect(e.sourceRefs.overtimeId).toBeUndefined();
  });

  it('weekend (Saturday) with no attendance / OT is WEEKEND', () => {
    const e = buildEntry(
      baseInput({
        weekday: 6, // Sat
      }),
    );
    expect(e.kind).toBe(TimesheetEntryKind.WEEKEND);
    expect(e.expectedHours).toBeNull();
  });

  it('bare working day without any source is WORKING with 0 hours', () => {
    const e = buildEntry(baseInput());
    expect(e.kind).toBe(TimesheetEntryKind.WORKING);
    expect(e.regularHours).toBe(0);
    expect(e.expectedHours).toBe(8);
  });

  it('describes lateness + early leave in the same note', () => {
    const e = buildEntry(
      baseInput({
        attendance: {
          workDate: '2026-08-05',
          clockInAt: new Date(),
          clockOutAt: new Date(),
          hoursWorked: 7,
          lateMinutes: 15,
          earlyLeaveMinutes: 30,
          attendanceId: 'A1',
        },
      }),
    );
    expect(e.note).toBe('Late 15m + Left early 30m');
  });
});

describe('rollupTimesheet', () => {
  it('sums regular, overtime, and buckets each kind correctly', () => {
    const totals = rollupTimesheet([
      {
        workDate: '2026-08-03',
        kind: TimesheetEntryKind.WORKING,
        expectedHours: 8,
        regularHours: 8,
        overtimeHours: 2,
        leaveHours: 0,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        sourceRefs: {},
        note: null,
      },
      {
        workDate: '2026-08-04',
        kind: TimesheetEntryKind.LEAVE,
        expectedHours: 8,
        regularHours: 0,
        overtimeHours: 0,
        leaveHours: 8,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        sourceRefs: {},
        note: null,
      },
      {
        workDate: '2026-08-05',
        kind: TimesheetEntryKind.HOLIDAY,
        expectedHours: null,
        regularHours: 0,
        overtimeHours: 0,
        leaveHours: 0,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        sourceRefs: {},
        note: null,
      },
      {
        workDate: '2026-08-06',
        kind: TimesheetEntryKind.ABSENT,
        expectedHours: 8,
        regularHours: 0,
        overtimeHours: 0,
        leaveHours: 0,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        sourceRefs: {},
        note: null,
      },
      {
        workDate: '2026-08-08',
        kind: TimesheetEntryKind.WEEKEND,
        expectedHours: null,
        regularHours: 0,
        overtimeHours: 0,
        leaveHours: 0,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        sourceRefs: {},
        note: null,
      },
    ]);
    expect(totals.totalRegularHours).toBe(8);
    expect(totals.totalOvertimeHours).toBe(2);
    expect(totals.totalWorkingDays).toBe(1);
    expect(totals.totalLeaveDays).toBe(1);
    expect(totals.totalHolidays).toBe(1);
    expect(totals.totalAbsentDays).toBe(1);
  });
});
