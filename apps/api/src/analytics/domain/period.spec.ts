import {
  asYmd,
  buildWindow,
  daysBefore,
  daysBetween,
  enumerateDays,
  isYmd,
  previousWindow,
  todayInTz,
  tzDayEndUtc,
  tzDayStartUtc,
} from './period';

describe('analytics/domain/period — Fase 33a pure helpers', () => {
  describe('isYmd + asYmd', () => {
    it('accepts well-formed YYYY-MM-DD strings', () => {
      expect(isYmd('2026-08-03')).toBe(true);
      expect(isYmd('2000-01-01')).toBe(true);
    });

    it('rejects malformed candidates', () => {
      expect(isYmd('2026-8-3')).toBe(false);
      expect(isYmd('2026/08/03')).toBe(false);
      expect(isYmd('not-a-date')).toBe(false);
      expect(isYmd('')).toBe(false);
    });

    it('asYmd throws on invalid input', () => {
      expect(() => asYmd('2026/08/03')).toThrow(/YYYY-MM-DD/);
    });
  });

  describe('todayInTz', () => {
    it('projects a UTC instant to different tenant calendar days', () => {
      const at = new Date('2026-08-03T22:30:00Z');
      expect(todayInTz(at, 'Asia/Jakarta')).toBe('2026-08-04');
      expect(todayInTz(at, 'Europe/London')).toBe('2026-08-03');
      expect(todayInTz(at, 'America/Los_Angeles')).toBe('2026-08-03');
    });
  });

  describe('daysBefore', () => {
    it('subtracts whole days regardless of DST', () => {
      expect(daysBefore(asYmd('2026-08-03'), 1)).toBe('2026-08-02');
      expect(daysBefore(asYmd('2026-08-03'), 30)).toBe('2026-07-04');
    });

    it('crosses month + year boundaries', () => {
      expect(daysBefore(asYmd('2026-01-01'), 1)).toBe('2025-12-31');
      expect(daysBefore(asYmd('2026-03-01'), 1)).toBe('2026-02-28');
      // Leap year edge
      expect(daysBefore(asYmd('2024-03-01'), 1)).toBe('2024-02-29');
    });

    it('supports negative n to shift forward', () => {
      expect(daysBefore(asYmd('2026-08-03'), -1)).toBe('2026-08-04');
    });
  });

  describe('daysBetween', () => {
    it('returns whole-day differences', () => {
      expect(daysBetween(asYmd('2026-08-01'), asYmd('2026-08-08'))).toBe(7);
      expect(daysBetween(asYmd('2026-08-08'), asYmd('2026-08-01'))).toBe(-7);
    });
  });

  describe('buildWindow', () => {
    it('anchors `to` at today-in-TZ and `from` days-1 before', () => {
      const now = new Date('2026-08-03T05:00:00Z'); // Jakarta 12:00
      const w = buildWindow(now, 'Asia/Jakarta', 30);
      expect(w.today).toBe('2026-08-03');
      expect(w.to).toBe('2026-08-03');
      expect(w.from).toBe('2026-07-05'); // 29 days before
      expect(w.days).toBe(30);
    });
  });

  describe('previousWindow', () => {
    it('immediately abuts the current window with no overlap', () => {
      const w = buildWindow(new Date('2026-08-03T05:00:00Z'), 'Asia/Jakarta', 7);
      const p = previousWindow(w);
      expect(p.to).toBe('2026-07-27');
      expect(p.from).toBe('2026-07-21');
      expect(p.days).toBe(7);
      // No overlap: p.to is exactly 1 day before w.from.
      expect(daysBefore(w.from, 1)).toBe(p.to);
    });
  });

  describe('enumerateDays', () => {
    it('returns inclusive-inclusive array of Y-M-D strings', () => {
      expect(enumerateDays(asYmd('2026-08-01'), asYmd('2026-08-03'))).toEqual([
        '2026-08-01',
        '2026-08-02',
        '2026-08-03',
      ]);
    });

    it('handles single-day and empty (reversed) ranges', () => {
      expect(enumerateDays(asYmd('2026-08-01'), asYmd('2026-08-01'))).toEqual([
        '2026-08-01',
      ]);
      expect(enumerateDays(asYmd('2026-08-02'), asYmd('2026-08-01'))).toEqual(
        [],
      );
    });
  });

  describe('tzDayStartUtc + tzDayEndUtc', () => {
    it('produces the correct UTC boundary for Asia/Jakarta (UTC+7, no DST)', () => {
      const start = tzDayStartUtc(asYmd('2026-08-03'), 'Asia/Jakarta');
      const end = tzDayEndUtc(asYmd('2026-08-03'), 'Asia/Jakarta');
      // Jakarta 2026-08-03 00:00 = 2026-08-02 17:00 UTC
      expect(start.toISOString()).toBe('2026-08-02T17:00:00.000Z');
      // Jakarta 2026-08-04 00:00 = 2026-08-03 17:00 UTC
      expect(end.toISOString()).toBe('2026-08-03T17:00:00.000Z');
    });

    it('handles DST-observing timezones without going wrong', () => {
      // London 2026-08-03 is BST (UTC+1) → midnight local = 23:00Z prior day.
      const start = tzDayStartUtc(asYmd('2026-08-03'), 'Europe/London');
      expect(start.toISOString()).toBe('2026-08-02T23:00:00.000Z');
    });
  });
});
