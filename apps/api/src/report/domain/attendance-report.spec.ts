import {
  formatDateInTz,
  formatTimeInTz,
  hoursWorked,
  summarize,
  toAttendanceReportRows,
  type AttendanceRawRecord,
} from './attendance-report';

const JKT = 'Asia/Jakarta';

describe('formatDateInTz / formatTimeInTz', () => {
  it('renders UTC 17:00 as 00:00 next day in Jakarta', () => {
    // 2026-03-14T17:00:00Z ⇒ 2026-03-15 00:00 in Asia/Jakarta (UTC+7)
    const t = new Date('2026-03-14T17:00:00Z');
    expect(formatDateInTz(t, JKT)).toBe('2026-03-15');
    expect(formatTimeInTz(t, JKT)).toBe('00:00');
  });

  it('renders known noon UTC in a positive-offset zone', () => {
    const t = new Date('2026-03-14T12:00:00Z');
    expect(formatDateInTz(t, JKT)).toBe('2026-03-14');
    expect(formatTimeInTz(t, JKT)).toBe('19:00');
  });
});

describe('hoursWorked', () => {
  it('rounds to two decimals', () => {
    const a = new Date('2026-03-14T01:00:00Z');
    const b = new Date('2026-03-14T09:30:00Z');
    expect(hoursWorked(a, b)).toBe(8.5);
  });

  it('is zero for reversed order (defensive)', () => {
    const a = new Date('2026-03-14T09:00:00Z');
    const b = new Date('2026-03-14T08:00:00Z');
    expect(hoursWorked(a, b)).toBe(0);
  });

  it('handles cross-midnight (23:30 → 07:00 UTC = 7.5h)', () => {
    const a = new Date('2026-03-14T23:30:00Z');
    const b = new Date('2026-03-15T07:00:00Z');
    expect(hoursWorked(a, b)).toBe(7.5);
  });
});

describe('toAttendanceReportRows', () => {
  const jakartaRecord: AttendanceRawRecord = {
    workDate: new Date('2026-03-14T00:00:00Z'),
    clockInAt: new Date('2026-03-14T01:05:00Z'), // 08:05 Jakarta
    clockOutAt: new Date('2026-03-14T10:12:00Z'), // 17:12 Jakarta
    status: 'LATE',
    lateMinutes: 5,
    earlyLeaveMinutes: 0,
    note: null,
    user: { fullName: 'Alice', email: 'a@x.test', department: { name: 'Eng' } },
    shift: { name: 'Morning' },
  };

  it('formats into renderer-ready rows in the requested timezone', () => {
    const [row] = toAttendanceReportRows([jakartaRecord], JKT);
    expect(row).toBeDefined();
    if (!row) throw new Error('unreachable');
    expect(row).toMatchObject({
      workDate: '2026-03-14',
      userFullName: 'Alice',
      userEmail: 'a@x.test',
      departmentName: 'Eng',
      shiftName: 'Morning',
      clockIn: '08:05',
      clockOut: '17:12',
      status: 'LATE',
      lateMinutes: 5,
      earlyLeaveMinutes: 0,
      note: '',
    });
    expect(row.hoursWorked).toBeCloseTo(9.12, 2);
  });

  it('handles missing department and clockOut', () => {
    const [row] = toAttendanceReportRows(
      [
        {
          ...jakartaRecord,
          clockOutAt: null,
          user: { fullName: 'Bob', email: 'b@x.test', department: null },
        },
      ],
      JKT,
    );
    if (!row) throw new Error('unreachable');
    expect(row.departmentName).toBe('—');
    expect(row.clockOut).toBe('');
    expect(row.hoursWorked).toBeNull();
  });

  it('coerces unknown status to ON_TIME (defensive)', () => {
    const [row] = toAttendanceReportRows(
      [{ ...jakartaRecord, status: 'GIBBERISH' }],
      JKT,
    );
    expect(row?.status).toBe('ON_TIME');
  });
});

describe('summarize', () => {
  it('aggregates counts, hours, and late minutes', () => {
    const rows = [
      { status: 'ON_TIME', hoursWorked: 8, lateMinutes: 0 },
      { status: 'LATE', hoursWorked: 8.25, lateMinutes: 12 },
      { status: 'ABSENT', hoursWorked: null, lateMinutes: 0 },
      { status: 'ON_LEAVE', hoursWorked: null, lateMinutes: 0 },
    ] as never;
    const s = summarize(rows);
    expect(s).toEqual({
      totalRows: 4,
      onTime: 1,
      late: 1,
      absent: 1,
      onLeave: 1,
      totalHours: 16.25,
      totalLateMinutes: 12,
    });
  });

  it('returns zeros for empty input', () => {
    expect(summarize([])).toEqual({
      totalRows: 0,
      onTime: 0,
      late: 0,
      absent: 0,
      onLeave: 0,
      totalHours: 0,
      totalLateMinutes: 0,
    });
  });
});
