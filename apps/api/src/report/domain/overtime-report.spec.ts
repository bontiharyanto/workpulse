import {
  summarizeOvertime,
  toOvertimeReportRows,
  type OvertimeRawRequest,
} from './overtime-report';

function raw(overrides: Partial<OvertimeRawRequest> = {}): OvertimeRawRequest {
  return {
    workDate: new Date('2026-08-03T00:00:00Z'), // Monday
    hours: { toString: () => '2' },
    baseRate: { toString: () => '50000' },
    rateMultiplier: { toString: () => '1.5' },
    ratePerHour: { toString: () => '75000' },
    totalAmount: { toString: () => '150000' },
    status: 'APPROVED',
    reason: 'Release cutoff',
    approvedAt: new Date('2026-08-04T02:00:00Z'),
    rejectedAt: null,
    createdAt: new Date('2026-08-03T14:00:00Z'),
    user: {
      fullName: 'Ada Lovelace',
      email: 'ada@x.test',
      department: { name: 'Engineering' },
    },
    ...overrides,
  };
}

describe('toOvertimeReportRows', () => {
  it('projects raw Prisma rows to presentation rows with dayKind', () => {
    const rows = toOvertimeReportRows(
      [raw()], // Monday → WEEKDAY
      new Set(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userFullName: 'Ada Lovelace',
      departmentName: 'Engineering',
      workDate: '2026-08-03',
      dayKind: 'WEEKDAY',
      hours: 2,
      ratePerHour: 75_000,
      totalAmount: 150_000,
      status: 'APPROVED',
    });
    expect(rows[0]!.decidedAt).toBe('2026-08-04T02:00:00.000Z');
  });

  it('uses holiday classification when workDate is on a listed holiday', () => {
    const rows = toOvertimeReportRows(
      [raw({ workDate: new Date('2026-08-17T00:00:00Z') })],
      new Set(['2026-08-17']),
    );
    expect(rows[0]!.dayKind).toBe('HOLIDAY');
  });

  it('picks rejectedAt for REJECTED rows and null for pending', () => {
    const rejected = raw({
      status: 'REJECTED',
      approvedAt: null,
      rejectedAt: new Date('2026-08-05T00:00:00Z'),
    });
    const pending = raw({ status: 'PENDING_APPROVAL', approvedAt: null, rejectedAt: null });
    const rows = toOvertimeReportRows([rejected, pending], new Set());
    expect(rows[0]!.decidedAt).toBe('2026-08-05T00:00:00.000Z');
    expect(rows[1]!.decidedAt).toBeNull();
  });

  it('falls back to em-dash when the user has no department', () => {
    const rows = toOvertimeReportRows(
      [raw({ user: { fullName: 'X', email: 'x@x.test', department: null } })],
      new Set(),
    );
    expect(rows[0]!.departmentName).toBe('—');
  });
});

describe('summarizeOvertime', () => {
  it('aggregates hours + amount and breaks them down by dayKind', () => {
    const rows = toOvertimeReportRows(
      [
        raw(), // Mon (WEEKDAY) hours=2 amount=150k
        raw({
          workDate: new Date('2026-08-01T00:00:00Z'), // Saturday
          hours: { toString: () => '3' },
          rateMultiplier: { toString: () => '2' },
          ratePerHour: { toString: () => '100000' },
          totalAmount: { toString: () => '300000' },
          user: { fullName: 'B', email: 'b@x.test', department: { name: 'Eng' } },
        }),
        raw({
          workDate: new Date('2026-08-17T00:00:00Z'), // Holiday
          hours: { toString: () => '1' },
          rateMultiplier: { toString: () => '3' },
          ratePerHour: { toString: () => '150000' },
          totalAmount: { toString: () => '150000' },
        }),
      ],
      new Set(['2026-08-17']),
    );
    const t = summarizeOvertime(rows);
    expect(t.requestCount).toBe(3);
    expect(t.users).toBe(2); // ada + b
    expect(t.totalHours).toBe(6);
    expect(t.totalAmount).toBe(600_000);
    expect(t.hoursByDayKind).toEqual({ WEEKDAY: 2, WEEKEND: 3, HOLIDAY: 1 });
    expect(t.amountByDayKind).toEqual({ WEEKDAY: 150_000, WEEKEND: 300_000, HOLIDAY: 150_000 });
  });

  it('returns zeros for an empty result set', () => {
    const t = summarizeOvertime([]);
    expect(t).toEqual({
      requestCount: 0,
      users: 0,
      totalHours: 0,
      totalAmount: 0,
      hoursByDayKind: { WEEKDAY: 0, WEEKEND: 0, HOLIDAY: 0 },
      amountByDayKind: { WEEKDAY: 0, WEEKEND: 0, HOLIDAY: 0 },
    });
  });
});
