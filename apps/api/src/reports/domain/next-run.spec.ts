import { InvalidCadenceError, advance, initialNextRun } from './next-run';

describe('Report scheduler next-run', () => {
  describe('DAILY', () => {
    it('rolls forward when today has already passed the cadenceHour', () => {
      const now = new Date('2026-09-01T10:00:00Z');
      const next = initialNextRun(now, {
        frequency: 'DAILY',
        cadenceDay: null,
        cadenceHourUtc: 6,
      });
      // 06:00 has passed for 2026-09-01 → next is 2026-09-02 06:00.
      expect(next.toISOString()).toBe('2026-09-02T06:00:00.000Z');
    });
    it('picks today when cadenceHour is still in the future', () => {
      const now = new Date('2026-09-01T04:00:00Z');
      const next = initialNextRun(now, {
        frequency: 'DAILY',
        cadenceDay: null,
        cadenceHourUtc: 6,
      });
      expect(next.toISOString()).toBe('2026-09-01T06:00:00.000Z');
    });
  });

  describe('WEEKLY', () => {
    it('advances to the next matching day-of-week', () => {
      // 2026-09-01 is a Tuesday (getUTCDay = 2). Aim for Friday (5).
      const now = new Date('2026-09-01T04:00:00Z');
      const next = advance(now, {
        frequency: 'WEEKLY',
        cadenceDay: 5,
        cadenceHourUtc: 8,
      });
      expect(next.toISOString()).toBe('2026-09-04T08:00:00.000Z');
    });
    it('wraps to next week when today matches but hour has passed', () => {
      // 2026-09-01 is a Tuesday. cadenceDay=2 (Tuesday), hour has passed.
      const now = new Date('2026-09-01T10:00:00Z');
      const next = advance(now, {
        frequency: 'WEEKLY',
        cadenceDay: 2,
        cadenceHourUtc: 6,
      });
      expect(next.toISOString()).toBe('2026-09-08T06:00:00.000Z');
    });
    it('rejects out-of-range cadenceDay', () => {
      expect(() =>
        advance(new Date('2026-09-01T04:00:00Z'), {
          frequency: 'WEEKLY',
          cadenceDay: 9,
          cadenceHourUtc: 6,
        }),
      ).toThrow(InvalidCadenceError);
    });
  });

  describe('MONTHLY', () => {
    it('picks the day within the current month if still ahead', () => {
      const now = new Date('2026-09-10T06:00:00Z');
      const next = advance(now, {
        frequency: 'MONTHLY',
        cadenceDay: 15,
        cadenceHourUtc: 3,
      });
      expect(next.toISOString()).toBe('2026-09-15T03:00:00.000Z');
    });
    it('rolls to next month when the day already passed', () => {
      const now = new Date('2026-09-20T06:00:00Z');
      const next = advance(now, {
        frequency: 'MONTHLY',
        cadenceDay: 5,
        cadenceHourUtc: 3,
      });
      expect(next.toISOString()).toBe('2026-10-05T03:00:00.000Z');
    });
    it('rejects cadenceDay > 28 to avoid month-length ambiguity', () => {
      expect(() =>
        advance(new Date('2026-09-01T04:00:00Z'), {
          frequency: 'MONTHLY',
          cadenceDay: 30,
          cadenceHourUtc: 3,
        }),
      ).toThrow(InvalidCadenceError);
    });
  });

  describe('advance produces strictly future timestamps', () => {
    it.each([
      ['DAILY' as const, null],
      ['WEEKLY' as const, 3],
      ['MONTHLY' as const, 10],
    ])('freq=%s day=%s', (frequency, cadenceDay) => {
      const now = new Date('2026-09-01T05:00:00Z');
      const next = advance(now, {
        frequency,
        cadenceDay,
        cadenceHourUtc: 5, // equal-hour edge → should still push forward
      });
      expect(next.getTime()).toBeGreaterThan(now.getTime());
    });
  });
});
