import { countBusinessDays } from './business-days';
import { assertCalendarDate, dayOfWeek, eachDay } from './calendar-date';

describe('countBusinessDays', () => {
  it('returns 0 when end is before start', () => {
    expect(countBusinessDays('2026-06-15', '2026-06-10')).toBe(0);
  });

  it('counts a single working day as 1', () => {
    // 2026-06-15 is a Monday
    expect(countBusinessDays('2026-06-15', '2026-06-15')).toBe(1);
  });

  it('returns 0 when the only day is a weekend (Saturday)', () => {
    expect(countBusinessDays('2026-06-20', '2026-06-20')).toBe(0);
  });

  it('counts Mon–Fri as 5 across a full week', () => {
    expect(countBusinessDays('2026-06-15', '2026-06-19')).toBe(5);
  });

  it('excludes weekends across a 9-day span', () => {
    // Mon 15 → Tue 23 = 7 working days (skip Sat 20 & Sun 21)
    expect(countBusinessDays('2026-06-15', '2026-06-23')).toBe(7);
  });

  it('excludes provided holidays', () => {
    expect(countBusinessDays('2026-06-15', '2026-06-19', { holidays: ['2026-06-17'] })).toBe(4);
  });

  it('does not double-count when a holiday falls on a weekend', () => {
    // Saturday holiday — already excluded as weekend
    expect(countBusinessDays('2026-06-15', '2026-06-21', { holidays: ['2026-06-20'] })).toBe(5);
  });

  it('supports a Middle-East-style weekend (Fri, Sat)', () => {
    // Mon 15 → Sun 21 with weekend = Fri(5), Sat(6):
    //   Mon 15, Tue 16, Wed 17, Thu 18, Sun 21 => 5
    expect(countBusinessDays('2026-06-15', '2026-06-21', { weekendDays: [5, 6] })).toBe(5);
  });
});

describe('calendar-date helpers', () => {
  it('assertCalendarDate rejects malformed strings', () => {
    expect(() => assertCalendarDate('2026-6-1')).toThrow(RangeError);
    expect(() => assertCalendarDate('2026-02-31')).toThrow(RangeError);
    expect(() => assertCalendarDate('not-a-date')).toThrow(RangeError);
  });

  it('dayOfWeek returns 0 (Sun) for 2026-06-14', () => {
    expect(dayOfWeek('2026-06-14')).toBe(0);
  });

  it('eachDay is inclusive of both ends and yields sequential dates', () => {
    const days = [...eachDay('2026-06-14', '2026-06-16')];
    expect(days).toEqual(['2026-06-14', '2026-06-15', '2026-06-16']);
  });

  it('eachDay handles month rollovers', () => {
    const days = [...eachDay('2026-06-29', '2026-07-02')];
    expect(days).toEqual(['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02']);
  });
});
