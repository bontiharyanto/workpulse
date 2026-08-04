import {
  OvertimeRateError,
  classifyDay,
  computeOvertimeRate,
  type CompanyOvertimePolicy,
} from './overtime-rate';

const POLICY: CompanyOvertimePolicy = {
  hourlyRate: 50_000,
  weekdayMultiplier: 1.5,
  weekendMultiplier: 2,
  holidayMultiplier: 3,
};

describe('classifyDay', () => {
  it('classifies Saturday and Sunday as WEEKEND', () => {
    // 2026-08-01 is a Saturday, 2026-08-02 is a Sunday.
    expect(classifyDay(new Date('2026-08-01T00:00:00Z'), new Set())).toBe('WEEKEND');
    expect(classifyDay(new Date('2026-08-02T00:00:00Z'), new Set())).toBe('WEEKEND');
  });

  it('classifies weekdays as WEEKDAY', () => {
    // 2026-08-03 is a Monday.
    expect(classifyDay(new Date('2026-08-03T00:00:00Z'), new Set())).toBe('WEEKDAY');
  });

  it('gives HOLIDAY precedence over WEEKEND for a Sunday holiday', () => {
    const sunday = new Date('2026-08-02T00:00:00Z');
    expect(classifyDay(sunday, new Set(['2026-08-02']))).toBe('HOLIDAY');
  });
});

describe('computeOvertimeRate', () => {
  it('uses the user override when present', () => {
    const r = computeOvertimeRate({
      hours: 2,
      workDate: new Date('2026-08-03T00:00:00Z'), // Monday
      userHourlyRateOverride: 100_000,
      companyPolicy: POLICY,
      holidaySet: new Set(),
    });
    expect(r.baseRate).toBe(100_000);
    expect(r.multiplier).toBe(1.5);
    expect(r.ratePerHour).toBe(150_000);
    expect(r.totalAmount).toBe(300_000);
    expect(r.dayKind).toBe('WEEKDAY');
  });

  it('falls back to the company rate when user override is null', () => {
    const r = computeOvertimeRate({
      hours: 3,
      workDate: new Date('2026-08-01T00:00:00Z'), // Saturday
      userHourlyRateOverride: null,
      companyPolicy: POLICY,
      holidaySet: new Set(),
    });
    expect(r.dayKind).toBe('WEEKEND');
    expect(r.ratePerHour).toBe(100_000); // 50000 * 2
    expect(r.totalAmount).toBe(300_000);
  });

  it('applies the holiday multiplier ahead of weekend', () => {
    const r = computeOvertimeRate({
      hours: 1,
      workDate: new Date('2026-08-02T00:00:00Z'), // Sunday
      userHourlyRateOverride: null,
      companyPolicy: POLICY,
      holidaySet: new Set(['2026-08-02']),
    });
    expect(r.dayKind).toBe('HOLIDAY');
    expect(r.ratePerHour).toBe(150_000); // 50000 * 3
    expect(r.totalAmount).toBe(150_000);
  });

  it('throws OvertimeRateError when neither user nor company rate is set', () => {
    expect(() =>
      computeOvertimeRate({
        hours: 1,
        workDate: new Date('2026-08-03T00:00:00Z'),
        userHourlyRateOverride: null,
        companyPolicy: { ...POLICY, hourlyRate: null },
        holidaySet: new Set(),
      }),
    ).toThrow(OvertimeRateError);
  });

  it('rounds ratePerHour and totalAmount to 2 decimals', () => {
    const r = computeOvertimeRate({
      hours: 1.5,
      workDate: new Date('2026-08-03T00:00:00Z'),
      userHourlyRateOverride: 33_333.335,
      companyPolicy: POLICY,
      holidaySet: new Set(),
    });
    expect(Number.isInteger(r.ratePerHour * 100)).toBe(true);
    expect(Number.isInteger(r.totalAmount * 100)).toBe(true);
  });
});
