import { buildCompanySnapshot } from './dashboard-snapshot';

function roster(items: Array<[string, string | null, string | null]>) {
  return items.map(([userId, departmentId, departmentName]) => ({
    userId,
    departmentId,
    departmentName,
  }));
}

function attendanceRow(
  userId: string,
  overrides: Partial<{ lateMinutes: number; earlyLeaveMinutes: number; status: string }> = {},
) {
  return {
    userId,
    lateMinutes: overrides.lateMinutes ?? 0,
    earlyLeaveMinutes: overrides.earlyLeaveMinutes ?? 0,
    status: overrides.status ?? 'ON_TIME',
  };
}

describe('buildCompanySnapshot', () => {
  it('classifies every roster member into exactly one bucket', () => {
    const r = roster([
      ['u1', 'd1', 'Engineering'],
      ['u2', 'd1', 'Engineering'],
      ['u3', 'd2', 'HR'],
      ['u4', 'd2', 'HR'],
    ]);
    const snap = buildCompanySnapshot(
      r,
      [attendanceRow('u1'), attendanceRow('u3')],
      [{ userId: 'u2' }],
      ['u4'],
    );
    expect(snap.total).toBe(4);
    expect(snap.clockedIn).toBe(2);
    expect(snap.absent).toBe(1);
    expect(snap.onLeave).toBe(1);
    expect(snap.notClockedIn).toBe(0);
    // total must equal the sum of statuses
    expect(snap.clockedIn + snap.absent + snap.onLeave + snap.notClockedIn).toBe(4);
  });

  it('gives precedence to CLOCKED_IN over ABSENT + ON_LEAVE (defensive)', () => {
    const snap = buildCompanySnapshot(
      roster([['u1', null, null]]),
      [attendanceRow('u1')],
      [{ userId: 'u1' }], // simultaneously marked absent — real DB shouldn't have this
      ['u1'],
    );
    expect(snap.clockedIn).toBe(1);
    expect(snap.absent).toBe(0);
    expect(snap.onLeave).toBe(0);
  });

  it('gives precedence to ABSENT over ON_LEAVE (approved leave later revoked)', () => {
    const snap = buildCompanySnapshot(roster([['u1', null, null]]), [], [{ userId: 'u1' }], ['u1']);
    expect(snap.absent).toBe(1);
    expect(snap.onLeave).toBe(0);
  });

  it('leaves users with no signal in NOT_CLOCKED_IN', () => {
    const snap = buildCompanySnapshot(roster([['u1', null, null]]), [], [], []);
    expect(snap.notClockedIn).toBe(1);
    expect(snap.total).toBe(1);
  });

  it('counts lateToday + earlyLeaveToday only from clocked-in rows', () => {
    const snap = buildCompanySnapshot(
      roster([
        ['u1', null, null],
        ['u2', null, null],
        ['u3', null, null],
      ]),
      [
        attendanceRow('u1', { lateMinutes: 15 }),
        attendanceRow('u2', { earlyLeaveMinutes: 20 }),
        attendanceRow('u3'), // on time
      ],
      [],
      [],
    );
    expect(snap.lateToday).toBe(1);
    expect(snap.earlyLeaveToday).toBe(1);
  });

  it('groups per department and unassigned users bucket into (Tanpa departemen)', () => {
    const r = roster([
      ['u1', 'd1', 'Engineering'],
      ['u2', 'd1', 'Engineering'],
      ['u3', null, null],
    ]);
    const snap = buildCompanySnapshot(r, [attendanceRow('u1')], [], []);
    const eng = snap.departments.find((d) => d.departmentId === 'd1');
    const unassigned = snap.departments.find((d) => d.departmentId === null);
    expect(eng).toBeDefined();
    expect(unassigned).toBeDefined();
    expect(eng?.total).toBe(2);
    expect(eng?.clockedIn).toBe(1);
    expect(unassigned?.total).toBe(1);
    expect(unassigned?.departmentName).toBe('(Tanpa departemen)');
  });

  it('sorts departments by exception count (absent + late) desc, then name asc', () => {
    const r = roster([
      ['u1', 'd1', 'Clean Team'],
      ['u2', 'd1', 'Clean Team'],
      ['u3', 'd2', 'Problem Team'],
      ['u4', 'd2', 'Problem Team'],
      ['u5', 'd2', 'Problem Team'],
    ]);
    const snap = buildCompanySnapshot(
      r,
      [attendanceRow('u1'), attendanceRow('u2'), attendanceRow('u4', { lateMinutes: 30 })],
      [{ userId: 'u3' }],
      [],
    );
    // Problem Team: 1 absent + 1 late = 2 exceptions
    // Clean Team: 0 exceptions
    expect(snap.departments[0]?.departmentName).toBe('Problem Team');
    expect(snap.departments[1]?.departmentName).toBe('Clean Team');
  });

  it('computes on-time rate correctly (clockedIn - late - early) / clockedIn', () => {
    const r = roster([
      ['u1', null, null],
      ['u2', null, null],
      ['u3', null, null],
      ['u4', null, null],
    ]);
    const snap = buildCompanySnapshot(
      r,
      [
        attendanceRow('u1'),
        attendanceRow('u2'),
        attendanceRow('u3', { lateMinutes: 5 }),
        attendanceRow('u4', { earlyLeaveMinutes: 10 }),
      ],
      [],
      [],
    );
    // 4 clocked in, 2 issues → on-time = 50%
    expect(snap.onTimeRatePercent).toBe(50);
  });

  it('returns null on-time rate when nobody clocked in (defensive against /0)', () => {
    const snap = buildCompanySnapshot(roster([['u1', null, null]]), [], [{ userId: 'u1' }], []);
    expect(snap.onTimeRatePercent).toBeNull();
  });

  it('produces an empty snapshot for an empty roster (no crashes, no NaN)', () => {
    const snap = buildCompanySnapshot([], [], [], []);
    expect(snap.total).toBe(0);
    expect(snap.departments).toEqual([]);
    expect(snap.onTimeRatePercent).toBeNull();
  });
});
