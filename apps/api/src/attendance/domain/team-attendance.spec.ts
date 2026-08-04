import {
  buildTeamDailyView,
  buildTeamSummary,
  type DailyAttendanceInput,
  type RangeAttendanceInput,
  type RosterMember,
} from './team-attendance';

const roster: RosterMember[] = [
  { userId: 'u1', fullName: 'Aditya', email: 'a@t.test', departmentName: 'Eng' },
  { userId: 'u2', fullName: 'Budi', email: 'b@t.test', departmentName: 'Eng' },
  { userId: 'u3', fullName: 'Cinta', email: 'c@t.test', departmentName: 'Sales' },
];

function rec(overrides: Partial<DailyAttendanceInput>): DailyAttendanceInput {
  return {
    userId: 'u1',
    status: 'ON_TIME',
    clockInAt: new Date('2026-08-01T02:00:00Z'),
    clockOutAt: new Date('2026-08-01T10:00:00Z'),
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    ...overrides,
  };
}

describe('buildTeamDailyView', () => {
  it('produces one row per roster member (present or not)', () => {
    const rows = buildTeamDailyView(roster, [rec({ userId: 'u1' })]);
    expect(rows).toHaveLength(3);
    const ids = rows.map((r) => r.userId).sort();
    expect(ids).toEqual(['u1', 'u2', 'u3']);
  });

  it('marks missing members as NOT_CLOCKED_IN (distinct from ABSENT)', () => {
    const rows = buildTeamDailyView(roster, []);
    for (const r of rows) {
      expect(r.status).toBe('NOT_CLOCKED_IN');
      expect(r.clockInAt).toBeNull();
      expect(r.lateMinutes).toBe(0);
    }
  });

  it('sorts exceptions first (LATE → EARLY_LEAVE → NOT_CLOCKED_IN → ON_TIME)', () => {
    const rows = buildTeamDailyView(roster, [
      rec({ userId: 'u1', status: 'ON_TIME' }),
      rec({ userId: 'u2', status: 'LATE', lateMinutes: 12 }),
      // u3 → NOT_CLOCKED_IN (no record)
    ]);
    expect(rows.map((r) => r.userId)).toEqual(['u2', 'u3', 'u1']);
  });

  it('breaks status ties by name (locale ID)', () => {
    const rows = buildTeamDailyView(roster, []); // all NOT_CLOCKED_IN
    expect(rows.map((r) => r.fullName)).toEqual(['Aditya', 'Budi', 'Cinta']);
  });

  it('propagates late/early minutes into the DTO', () => {
    const rows = buildTeamDailyView(roster, [
      rec({ userId: 'u1', status: 'LATE', lateMinutes: 7, earlyLeaveMinutes: 3 }),
    ]);
    const u1 = rows.find((r) => r.userId === 'u1');
    expect(u1?.lateMinutes).toBe(7);
    expect(u1?.earlyLeaveMinutes).toBe(3);
  });
});

// ---------------------------------------------------------------------------

function rr(overrides: Partial<RangeAttendanceInput>): RangeAttendanceInput {
  return {
    userId: 'u1',
    status: 'ON_TIME',
    clockInAt: new Date('2026-08-01T02:00:00Z'),
    clockOutAt: new Date('2026-08-01T10:00:00Z'),
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    ...overrides,
  };
}

describe('buildTeamSummary', () => {
  it('emits a zero-row for every roster member (even absent people)', () => {
    const rows = buildTeamSummary(roster, []);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.presentDays).toBe(0);
      expect(r.onTimeRatePercent).toBeNull();
    }
  });

  it('sorts by worst on-time rate first', () => {
    const rows = buildTeamSummary(roster, [
      rr({ userId: 'u1' }), // 100% on time
      rr({ userId: 'u2', status: 'LATE', lateMinutes: 15 }), // 0% on time
      rr({ userId: 'u3' }),
      rr({
        userId: 'u3',
        clockInAt: new Date('2026-08-02T02:00:00Z'),
        clockOutAt: new Date('2026-08-02T10:00:00Z'),
      }),
    ]);
    expect(rows[0]?.userId).toBe('u2'); // worst on-time rate
    // u1 (Aditya) + u3 (Cinta) tie on 100%; alphabetical tie-break sorts Aditya first.
    expect(rows[rows.length - 1]?.userId).toBe('u3');
  });

  it('ignores ABSENT/ON_LEAVE for presentDays and hours', () => {
    const rows = buildTeamSummary(roster, [
      rr({ userId: 'u1' }),
      rr({ userId: 'u1', status: 'ON_LEAVE' }),
      rr({ userId: 'u1', status: 'ABSENT' }),
    ]);
    const u1 = rows.find((r) => r.userId === 'u1');
    expect(u1?.presentDays).toBe(1);
    expect(u1?.totalHoursWorked).toBe(8);
  });

  it('does NOT count purely-early-leave day as on-time', () => {
    const rows = buildTeamSummary(roster, [
      rr({ userId: 'u1', status: 'EARLY_LEAVE', earlyLeaveMinutes: 20 }),
    ]);
    const u1 = rows.find((r) => r.userId === 'u1');
    expect(u1?.onTimeDays).toBe(0);
    expect(u1?.earlyLeaveDays).toBe(1);
  });

  it('drops records for users not in roster (RBAC belt-and-suspenders)', () => {
    // A record leaking in for someone not on the actor's roster must NOT
    // contribute to any row.
    const rows = buildTeamSummary(roster, [rr({ userId: 'not-on-roster' })]);
    expect(rows.every((r) => r.presentDays === 0)).toBe(true);
  });

  it('populates absentDays from the caller-supplied map', () => {
    const rows = buildTeamSummary(roster, [rr({ userId: 'u1' })], {
      absentDaysByUserId: { u1: 2, u2: 5, unknown: 99 },
    });
    expect(rows.find((r) => r.userId === 'u1')?.absentDays).toBe(2);
    expect(rows.find((r) => r.userId === 'u2')?.absentDays).toBe(5);
    expect(rows.find((r) => r.userId === 'u3')?.absentDays).toBe(0);
  });

  it('accepts either Map or plain object for absentDaysByUserId', () => {
    const rows = buildTeamSummary(roster, [], {
      absentDaysByUserId: new Map([
        ['u1', 3],
        ['u2', 1],
      ]),
    });
    expect(rows.find((r) => r.userId === 'u1')?.absentDays).toBe(3);
  });
});

describe('buildTeamDailyView — absence & leave overlays', () => {
  it('promotes NOT_CLOCKED_IN to ABSENT when the userId is in absentUserIds', () => {
    const view = buildTeamDailyView(roster, [], {
      absentUserIds: new Set(['u1']),
    });
    const u1 = view.find((r) => r.userId === 'u1');
    expect(u1?.status).toBe('ABSENT');
  });

  it('promotes NOT_CLOCKED_IN to ON_LEAVE when the userId is in onLeaveUserIds', () => {
    const view = buildTeamDailyView(roster, [], {
      onLeaveUserIds: ['u2'],
    });
    expect(view.find((r) => r.userId === 'u2')?.status).toBe('ON_LEAVE');
  });

  it('AttendanceRecord wins over overlay classification (defensive)', () => {
    const view = buildTeamDailyView(roster, [rec({ userId: 'u1' })], {
      absentUserIds: ['u1'],
    });
    // The `rec` helper produces status ON_TIME; the absent overlay should
    // NOT overwrite it. Also verify absence metadata is NOT leaked onto
    // the row when attendance wins.
    const u1 = view.find((r) => r.userId === 'u1');
    expect(u1?.status).toBe('ON_TIME');
    expect(u1?.absenceRecordId).toBeNull();
    expect(u1?.absenceSource).toBeNull();
  });

  it('threads absenceRecordId + absenceSource onto ABSENT rows from the richer overlay', () => {
    const view = buildTeamDailyView(roster, [], {
      absences: [
        { userId: 'u1', absenceRecordId: 'abs-1', source: 'AUTO_SCHEDULER' },
        { userId: 'u3', absenceRecordId: 'abs-2', source: 'MANUAL_HR' },
      ],
    });
    const u1 = view.find((r) => r.userId === 'u1');
    const u3 = view.find((r) => r.userId === 'u3');
    expect(u1?.status).toBe('ABSENT');
    expect(u1?.absenceRecordId).toBe('abs-1');
    expect(u1?.absenceSource).toBe('AUTO_SCHEDULER');
    expect(u3?.absenceRecordId).toBe('abs-2');
    expect(u3?.absenceSource).toBe('MANUAL_HR');
  });

  it('produces null absenceRecordId + absenceSource for non-absent rows', () => {
    const view = buildTeamDailyView(roster, [], {
      onLeaveUserIds: ['u1'],
    });
    const u1 = view.find((r) => r.userId === 'u1');
    expect(u1?.status).toBe('ON_LEAVE');
    expect(u1?.absenceRecordId).toBeNull();
    expect(u1?.absenceSource).toBeNull();
  });
});
