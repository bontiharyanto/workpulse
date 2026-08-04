import {
  classifyAbsence,
  isWeekendDate,
  pendingScanDates,
  resolveTargetDate,
} from './absence-scanner';

describe('resolveTargetDate', () => {
  it('returns yesterday-in-tz when we are well past the grace window', () => {
    // 2026-08-02 09:00 UTC → 16:00 Asia/Jakarta (UTC+7)
    const now = new Date('2026-08-02T09:00:00Z');
    expect(resolveTargetDate(now, 'Asia/Jakarta', 6)).toBe('2026-08-01');
  });

  it('returns null when the grace window has not yet elapsed today', () => {
    // 2026-08-02 00:30 UTC → 07:30 Asia/Jakarta. graceHours=8 → too early.
    const now = new Date('2026-08-02T00:30:00Z');
    expect(resolveTargetDate(now, 'Asia/Jakarta', 8)).toBeNull();
  });

  it('honors negative-offset timezones (America/New_York) correctly', () => {
    // 2026-08-02 12:00 UTC → 08:00 America/New_York (UTC-4 DST). graceHours=6.
    const now = new Date('2026-08-02T12:00:00Z');
    expect(resolveTargetDate(now, 'America/New_York', 6)).toBe('2026-08-01');
  });

  it('handles the boundary — exactly graceHours into the day', () => {
    // 2026-08-02 23:00 UTC → 06:00 Asia/Jakarta next day (already Aug 3 local!)
    // 06:00 == graceHours=6 → boundary; not strictly less → target is Aug 2.
    const now = new Date('2026-08-02T23:00:00Z');
    expect(resolveTargetDate(now, 'Asia/Jakarta', 6)).toBe('2026-08-02');
  });

  it('handles zero grace (scan immediately after midnight)', () => {
    // 2026-08-02 00:00 UTC → Aug 2 00:00 UTC = Aug 2 07:00 Jakarta (hours=7).
    const now = new Date('2026-08-02T00:00:00Z');
    expect(resolveTargetDate(now, 'Asia/Jakarta', 0)).toBe('2026-08-01');
  });
});

describe('pendingScanDates', () => {
  it('returns just the target when lastScanned is the day before', () => {
    expect(pendingScanDates('2026-08-05', '2026-08-04', 30)).toEqual(['2026-08-05']);
  });

  it('returns empty when the target has already been scanned', () => {
    expect(pendingScanDates('2026-08-05', '2026-08-05', 30)).toEqual([]);
  });

  it('backfills every date between lastScanned and target', () => {
    expect(pendingScanDates('2026-08-05', '2026-08-02', 30)).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
    ]);
  });

  it('caps the backfill at maxBackfillDays', () => {
    // lastScanned=null → would go back to epoch; capped to 3 days back.
    expect(pendingScanDates('2026-08-05', null, 3)).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
    ]);
  });

  it('caps even when lastScanned is ancient', () => {
    expect(pendingScanDates('2026-08-05', '2020-01-01', 3)).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
    ]);
  });
});

describe('classifyAbsence', () => {
  const base = {
    targetDate: '2026-08-05', // a Wednesday
    employmentStatus: 'ACTIVE',
    hiredAt: '2020-01-01',
    hasShiftAssignment: true,
    isHoliday: false,
    isWeekend: false,
    hasAttendance: false,
    hasApprovedLeave: false,
    hasExistingAbsence: false,
  };

  it('marks a schedule-holding active employee who did not clock in as ABSENT', () => {
    expect(classifyAbsence(base)).toEqual({ kind: 'ABSENT' });
  });

  it('skips TERMINATED employees', () => {
    expect(classifyAbsence({ ...base, employmentStatus: 'TERMINATED' })).toEqual({
      kind: 'SKIP',
      reason: 'INACTIVE',
    });
  });

  it('skips SUSPENDED employees', () => {
    expect(classifyAbsence({ ...base, employmentStatus: 'SUSPENDED' })).toEqual({
      kind: 'SKIP',
      reason: 'INACTIVE',
    });
  });

  it('skips employees who were not yet hired on the target date', () => {
    expect(classifyAbsence({ ...base, hiredAt: '2026-09-01', targetDate: '2026-08-05' })).toEqual({
      kind: 'SKIP',
      reason: 'NOT_HIRED_YET',
    });
  });

  it('skips weekends (Sat/Sun) regardless of shift', () => {
    expect(classifyAbsence({ ...base, isWeekend: true })).toEqual({
      kind: 'SKIP',
      reason: 'WEEKEND',
    });
  });

  it('skips company holidays', () => {
    expect(classifyAbsence({ ...base, isHoliday: true })).toEqual({
      kind: 'SKIP',
      reason: 'HOLIDAY',
    });
  });

  it('skips employees who never had a shift assignment for the day', () => {
    expect(classifyAbsence({ ...base, hasShiftAssignment: false })).toEqual({
      kind: 'SKIP',
      reason: 'NO_SHIFT_ASSIGNMENT',
    });
  });

  it('skips employees who actually clocked in', () => {
    expect(classifyAbsence({ ...base, hasAttendance: true })).toEqual({
      kind: 'SKIP',
      reason: 'CLOCKED_IN',
    });
  });

  it('skips employees on approved leave', () => {
    expect(classifyAbsence({ ...base, hasApprovedLeave: true })).toEqual({
      kind: 'SKIP',
      reason: 'ON_APPROVED_LEAVE',
    });
  });

  it('is idempotent — already-marked days are skipped', () => {
    expect(classifyAbsence({ ...base, hasExistingAbsence: true })).toEqual({
      kind: 'SKIP',
      reason: 'ALREADY_MARKED',
    });
  });

  it('prioritises TERMINATED over CLOCKED_IN if both hold (defense against orphaned data)', () => {
    expect(
      classifyAbsence({
        ...base,
        employmentStatus: 'TERMINATED',
        hasAttendance: true,
      }),
    ).toEqual({ kind: 'SKIP', reason: 'INACTIVE' });
  });
});

describe('isWeekendDate', () => {
  it('detects Saturdays', () => {
    // 2026-08-01 is a Saturday
    expect(isWeekendDate('2026-08-01')).toBe(true);
  });

  it('detects Sundays', () => {
    // 2026-08-02 is a Sunday
    expect(isWeekendDate('2026-08-02')).toBe(true);
  });

  it('returns false for weekdays', () => {
    expect(isWeekendDate('2026-08-03')).toBe(false); // Mon
    expect(isWeekendDate('2026-08-07')).toBe(false); // Fri
  });
});
