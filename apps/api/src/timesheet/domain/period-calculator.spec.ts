import { TimesheetPeriodType, WeekStartDay } from '@prisma/client';

import { calculatePeriod, type PeriodCalculatorConfig } from './period-calculator';

const TZ_JAKARTA = 'Asia/Jakarta';

function cfg(overrides: Partial<PeriodCalculatorConfig>): PeriodCalculatorConfig {
  return {
    periodType: TimesheetPeriodType.MONTHLY,
    weekStartDay: WeekStartDay.MONDAY,
    biweeklyAnchor: null,
    cutoffDayOfMonth: null,
    timezone: TZ_JAKARTA,
    ...overrides,
  };
}

describe('calculatePeriod — WEEKLY', () => {
  it('MONDAY-anchored window on a Wednesday returns Mon..Sun', () => {
    // 2026-08-05T10:00:00Z is Wed 2026-08-05 17:00 in Jakarta.
    const wed = new Date('2026-08-05T10:00:00Z');
    const p = calculatePeriod(
      wed,
      cfg({
        periodType: TimesheetPeriodType.WEEKLY,
        weekStartDay: WeekStartDay.MONDAY,
      }),
    );
    expect(p.periodStart.toISOString()).toBe('2026-08-03T00:00:00.000Z');
    expect(p.periodEnd.toISOString()).toBe('2026-08-09T00:00:00.000Z');
    expect(p.label).toMatch(/^W\d{2} 2026$/);
  });

  it('SUNDAY-anchored window on a Wednesday returns Sun..Sat', () => {
    const wed = new Date('2026-08-05T10:00:00Z');
    const p = calculatePeriod(
      wed,
      cfg({
        periodType: TimesheetPeriodType.WEEKLY,
        weekStartDay: WeekStartDay.SUNDAY,
      }),
    );
    expect(p.periodStart.toISOString()).toBe('2026-08-02T00:00:00.000Z');
    expect(p.periodEnd.toISOString()).toBe('2026-08-08T00:00:00.000Z');
  });

  it('a Monday returns the same day as periodStart', () => {
    const mon = new Date('2026-08-03T10:00:00Z');
    const p = calculatePeriod(
      mon,
      cfg({
        periodType: TimesheetPeriodType.WEEKLY,
        weekStartDay: WeekStartDay.MONDAY,
      }),
    );
    expect(p.periodStart.toISOString()).toBe('2026-08-03T00:00:00.000Z');
    expect(p.periodEnd.toISOString()).toBe('2026-08-09T00:00:00.000Z');
  });
});

describe('calculatePeriod — BIWEEKLY', () => {
  it('honours the supplied anchor', () => {
    // Anchor 2026-08-03 (Mon). Instant 2026-08-14 → within first window.
    const at = new Date('2026-08-14T10:00:00Z');
    const p = calculatePeriod(
      at,
      cfg({
        periodType: TimesheetPeriodType.BIWEEKLY,
        biweeklyAnchor: new Date('2026-08-03T00:00:00Z'),
      }),
    );
    expect(p.periodStart.toISOString()).toBe('2026-08-03T00:00:00.000Z');
    expect(p.periodEnd.toISOString()).toBe('2026-08-16T00:00:00.000Z');
  });

  it('advances to the next 14-day window after the anchor rolls over', () => {
    const at = new Date('2026-08-17T10:00:00Z'); // day 14 after anchor 2026-08-03
    const p = calculatePeriod(
      at,
      cfg({
        periodType: TimesheetPeriodType.BIWEEKLY,
        biweeklyAnchor: new Date('2026-08-03T00:00:00Z'),
      }),
    );
    expect(p.periodStart.toISOString()).toBe('2026-08-17T00:00:00.000Z');
    expect(p.periodEnd.toISOString()).toBe('2026-08-30T00:00:00.000Z');
  });

  it('falls back to a deterministic anchor when biweeklyAnchor is null', () => {
    const at = new Date('2026-08-14T10:00:00Z');
    const p = calculatePeriod(at, cfg({ periodType: TimesheetPeriodType.BIWEEKLY }));
    // Anchor is 2000-01-03 (Mon). Windows are stable per-fortnight.
    const days = (p.periodEnd.getTime() - p.periodStart.getTime()) / 86_400_000;
    expect(days).toBe(13); // inclusive 14-day span
  });
});

describe('calculatePeriod — MONTHLY', () => {
  it('returns the calendar month around an instant in the middle', () => {
    const at = new Date('2026-08-15T10:00:00Z');
    const p = calculatePeriod(at, cfg({ periodType: TimesheetPeriodType.MONTHLY }));
    expect(p.periodStart.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(p.periodEnd.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    expect(p.label).toBe('Aug 2026');
  });

  it('handles February correctly on a leap year', () => {
    const at = new Date('2028-02-15T10:00:00Z');
    const p = calculatePeriod(at, cfg({ periodType: TimesheetPeriodType.MONTHLY }));
    expect(p.periodStart.toISOString()).toBe('2028-02-01T00:00:00.000Z');
    expect(p.periodEnd.toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });

  it('respects tenant timezone at month boundaries', () => {
    // 2026-09-01T00:30 Jakarta = 2026-08-31T17:30 UTC. The calendar
    // day in Jakarta is 2026-09-01, so the period should be September.
    const at = new Date('2026-08-31T17:30:00Z');
    const p = calculatePeriod(at, cfg({ periodType: TimesheetPeriodType.MONTHLY }));
    expect(p.periodStart.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(p.periodEnd.toISOString()).toBe('2026-09-30T00:00:00.000Z');
  });
});

describe('calculatePeriod — CUTOFF', () => {
  it('returns [prev-26 .. this-25] when instant is on or before cutoff', () => {
    const at = new Date('2026-08-15T10:00:00Z'); // day 15, cutoff 25
    const p = calculatePeriod(
      at,
      cfg({ periodType: TimesheetPeriodType.CUTOFF, cutoffDayOfMonth: 25 }),
    );
    expect(p.periodStart.toISOString()).toBe('2026-07-26T00:00:00.000Z');
    expect(p.periodEnd.toISOString()).toBe('2026-08-25T00:00:00.000Z');
  });

  it('returns [this-26 .. next-25] when instant is after cutoff', () => {
    const at = new Date('2026-08-27T10:00:00Z'); // day 27, cutoff 25
    const p = calculatePeriod(
      at,
      cfg({ periodType: TimesheetPeriodType.CUTOFF, cutoffDayOfMonth: 25 }),
    );
    expect(p.periodStart.toISOString()).toBe('2026-08-26T00:00:00.000Z');
    expect(p.periodEnd.toISOString()).toBe('2026-09-25T00:00:00.000Z');
  });

  it('cutoff on the exact day belongs to the closing window', () => {
    const at = new Date('2026-08-25T10:00:00Z'); // Jakarta day 25 too
    const p = calculatePeriod(
      at,
      cfg({ periodType: TimesheetPeriodType.CUTOFF, cutoffDayOfMonth: 25 }),
    );
    expect(p.periodEnd.toISOString()).toBe('2026-08-25T00:00:00.000Z');
  });

  it('throws when cutoffDayOfMonth is missing', () => {
    expect(() =>
      calculatePeriod(new Date(), cfg({ periodType: TimesheetPeriodType.CUTOFF })),
    ).toThrow(/cutoffDayOfMonth is null/);
  });

  it('throws when cutoffDayOfMonth is out of range', () => {
    expect(() =>
      calculatePeriod(
        new Date(),
        cfg({
          periodType: TimesheetPeriodType.CUTOFF,
          cutoffDayOfMonth: 29,
        }),
      ),
    ).toThrow(RangeError);
  });
});
