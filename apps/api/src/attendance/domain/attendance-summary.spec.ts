import { summarizeAttendance, type AttendanceSummaryInput } from './attendance-summary';

function row(overrides: Partial<AttendanceSummaryInput>): AttendanceSummaryInput {
  return {
    status: 'ON_TIME',
    clockInAt: new Date('2026-08-01T02:00:00Z'),
    clockOutAt: new Date('2026-08-01T10:00:00Z'), // 8h
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    ...overrides,
  };
}

describe('summarizeAttendance', () => {
  it('returns null on-time rate when the month is empty', () => {
    const s = summarizeAttendance([]);
    expect(s).toEqual({
      totalRecords: 0,
      presentDays: 0,
      onTimeDays: 0,
      lateDays: 0,
      earlyLeaveDays: 0,
      absentDays: 0,
      totalLateMinutes: 0,
      totalEarlyLeaveMinutes: 0,
      totalHoursWorked: 0,
      onTimeRatePercent: null,
    });
  });

  it('carries the caller-supplied absentDaysCount into the summary output', () => {
    const s = summarizeAttendance([row({})], { absentDaysCount: 3 });
    expect(s.presentDays).toBe(1);
    expect(s.absentDays).toBe(3);
  });

  it('clamps negative or fractional absentDaysCount to a sane integer', () => {
    expect(summarizeAttendance([], { absentDaysCount: -5 }).absentDays).toBe(0);
    expect(summarizeAttendance([], { absentDaysCount: 2.7 }).absentDays).toBe(2);
  });

  it('counts clean days towards onTimeDays', () => {
    const s = summarizeAttendance([row({}), row({}), row({})]);
    expect(s.presentDays).toBe(3);
    expect(s.onTimeDays).toBe(3);
    expect(s.lateDays).toBe(0);
    expect(s.onTimeRatePercent).toBe(100);
    expect(s.totalHoursWorked).toBe(24);
  });

  it('excludes ABSENT and ON_LEAVE rows from presentDays and hours', () => {
    const s = summarizeAttendance([
      row({ status: 'ON_TIME' }),
      row({ status: 'ABSENT' }),
      row({ status: 'ON_LEAVE' }),
    ]);
    expect(s.totalRecords).toBe(3);
    expect(s.presentDays).toBe(1);
    expect(s.totalHoursWorked).toBe(8);
  });

  it('flags both late and early on a single row when applicable', () => {
    const s = summarizeAttendance([row({ status: 'LATE', lateMinutes: 12, earlyLeaveMinutes: 8 })]);
    expect(s.lateDays).toBe(1);
    expect(s.earlyLeaveDays).toBe(1);
    expect(s.onTimeDays).toBe(0);
    expect(s.totalLateMinutes).toBe(12);
    expect(s.totalEarlyLeaveMinutes).toBe(8);
  });

  it('does NOT count a purely-early-leave row as onTime', () => {
    // Was on-time entering (lateMinutes = 0) but bailed early → shouldn't
    // sneak into onTimeDays.
    const s = summarizeAttendance([
      row({ status: 'EARLY_LEAVE', lateMinutes: 0, earlyLeaveMinutes: 15 }),
    ]);
    expect(s.onTimeDays).toBe(0);
    expect(s.earlyLeaveDays).toBe(1);
  });

  it('ignores rows without clockOutAt in totalHoursWorked (still on-shift)', () => {
    const s = summarizeAttendance([row({}), row({ clockOutAt: null })]);
    expect(s.totalHoursWorked).toBe(8);
    expect(s.presentDays).toBe(2); // Still counts as present
  });

  it('rounds on-time rate to 1 decimal', () => {
    const s = summarizeAttendance([
      row({ status: 'ON_TIME' }),
      row({ status: 'LATE', lateMinutes: 5 }),
      row({ status: 'LATE', lateMinutes: 5 }),
    ]);
    expect(s.onTimeRatePercent).toBe(33.3);
  });
});
