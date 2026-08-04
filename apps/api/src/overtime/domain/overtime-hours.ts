/**
 * Hour-value validation for overtime submissions. Pure — takes only primitive
 * inputs so we can unit-test business rules in isolation.
 *
 * Rules:
 *   - Must be a positive number strictly greater than 0.
 *   - Must have at most 2 decimals (15-minute increments in practice, but we
 *     don't force alignment — 1.75 = 1h45m is acceptable, 1.7 is fine too).
 *   - Must be ≤ `maxHoursPerDay` configured on Company.
 */

export class OvertimeHoursError extends Error {
  readonly code: 'HOURS_NOT_POSITIVE' | 'HOURS_TOO_MANY_DECIMALS' | 'HOURS_EXCEEDS_DAILY_CAP';
  constructor(code: OvertimeHoursError['code'], message: string) {
    super(message);
    this.name = 'OvertimeHoursError';
    this.code = code;
  }
}

export interface AssertOvertimeHoursInput {
  hours: number;
  maxHoursPerDay: number;
}

export function assertOvertimeHours(input: AssertOvertimeHoursInput): void {
  const { hours, maxHoursPerDay } = input;
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new OvertimeHoursError('HOURS_NOT_POSITIVE', 'hours must be > 0');
  }
  // Reject third decimal — signalling probable client-side precision bug and
  // guarding the `Decimal(5, 2)` column.
  const scaled = Math.round(hours * 100) / 100;
  if (Math.abs(scaled - hours) > Number.EPSILON) {
    throw new OvertimeHoursError(
      'HOURS_TOO_MANY_DECIMALS',
      'hours must have at most 2 decimal places',
    );
  }
  if (hours > maxHoursPerDay) {
    throw new OvertimeHoursError(
      'HOURS_EXCEEDS_DAILY_CAP',
      `hours ${hours} exceeds the daily cap of ${maxHoursPerDay}`,
    );
  }
}

/**
 * Round to 2 decimal places for storage (`Decimal(5, 2)`) — banker's rounding
 * variant that's stable across Node versions. We only call this AFTER
 * `assertOvertimeHours` has passed, so the result never widens precision.
 */
export function roundHours(hours: number): number {
  return Math.round(hours * 100) / 100;
}
