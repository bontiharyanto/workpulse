import { OvertimeHoursError, assertOvertimeHours, roundHours } from './overtime-hours';

describe('assertOvertimeHours', () => {
  const cap = 4;

  it('accepts a valid positive number within the cap', () => {
    expect(() => assertOvertimeHours({ hours: 2, maxHoursPerDay: cap })).not.toThrow();
    expect(() => assertOvertimeHours({ hours: 3.5, maxHoursPerDay: cap })).not.toThrow();
    expect(() => assertOvertimeHours({ hours: 0.25, maxHoursPerDay: cap })).not.toThrow();
    // Exactly at the cap → still allowed.
    expect(() => assertOvertimeHours({ hours: cap, maxHoursPerDay: cap })).not.toThrow();
  });

  it.each([
    [0, 'HOURS_NOT_POSITIVE'],
    [-1, 'HOURS_NOT_POSITIVE'],
    [Number.NaN, 'HOURS_NOT_POSITIVE'],
    [Number.POSITIVE_INFINITY, 'HOURS_NOT_POSITIVE'],
  ])('rejects non-positive %s → %s', (hours, code) => {
    let caught: OvertimeHoursError | null = null;
    try {
      assertOvertimeHours({ hours, maxHoursPerDay: cap });
    } catch (e) {
      caught = e as OvertimeHoursError;
    }
    // POSITIVE_INFINITY is not > 0 in the finite sense; also fails `Number.isFinite`
    expect(caught?.code).toBe(code);
  });

  it('rejects three or more decimals to protect Decimal(5,2)', () => {
    let caught: OvertimeHoursError | null = null;
    try {
      assertOvertimeHours({ hours: 1.234, maxHoursPerDay: cap });
    } catch (e) {
      caught = e as OvertimeHoursError;
    }
    expect(caught?.code).toBe('HOURS_TOO_MANY_DECIMALS');
  });

  it('rejects hours exceeding the daily cap', () => {
    let caught: OvertimeHoursError | null = null;
    try {
      assertOvertimeHours({ hours: 5, maxHoursPerDay: cap });
    } catch (e) {
      caught = e as OvertimeHoursError;
    }
    expect(caught?.code).toBe('HOURS_EXCEEDS_DAILY_CAP');
  });
});

describe('roundHours', () => {
  it('rounds to 2 decimal places', () => {
    expect(roundHours(1.234)).toBe(1.23);
    expect(roundHours(1.235)).toBeCloseTo(1.24, 2);
  });
});
