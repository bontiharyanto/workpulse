/**
 * Overtime rate computation. Pure — everything the service needs to compute
 * a rate lives here, so we can unit-test edge cases (weekend classification
 * around the ISO week boundary, holiday-on-a-Sunday etc.) without spinning up
 * Prisma.
 *
 * Precedence:
 *   1. User-level `overtimeHourlyRate` (payroll override) if present.
 *   2. Company-level `overtimeHourlyRate`.
 *   3. If neither is configured → throws — the service maps this to a
 *      400 `OVERTIME_RATE_NOT_CONFIGURED` for a friendlier admin nudge.
 *
 * Day classification (Indonesia default — Sun/Sat are weekend):
 *   - Holiday (workDate ∈ holidays) → `HOLIDAY` multiplier
 *   - else Saturday / Sunday → `WEEKEND`
 *   - else → `WEEKDAY`
 *
 * Holiday takes precedence over weekend — a company that observes both should
 * only get the *higher* multiplier for that day, never stack them.
 */

export type OvertimeDayKind = 'WEEKDAY' | 'WEEKEND' | 'HOLIDAY';

export class OvertimeRateError extends Error {
  readonly code: 'OVERTIME_RATE_NOT_CONFIGURED';
  constructor(message: string) {
    super(message);
    this.name = 'OvertimeRateError';
    this.code = 'OVERTIME_RATE_NOT_CONFIGURED';
  }
}

export interface CompanyOvertimePolicy {
  hourlyRate: number | null; // null if not configured
  weekdayMultiplier: number;
  weekendMultiplier: number;
  holidayMultiplier: number;
}

export interface RateComputationInput {
  hours: number;
  workDate: Date; // interpreted in the calendar sense — see `classifyDay`
  userHourlyRateOverride: number | null;
  companyPolicy: CompanyOvertimePolicy;
  /**
   * ISO date strings `YYYY-MM-DD` for holidays that fall in this window.
   * We accept the pre-projected set rather than a `Holiday[]` so the domain
   * stays free of Prisma types.
   */
  holidaySet: ReadonlySet<string>;
}

export interface RateComputationResult {
  dayKind: OvertimeDayKind;
  baseRate: number;
  multiplier: number;
  ratePerHour: number;
  totalAmount: number;
}

/**
 * Classify a UTC-noon `Date` as WEEKDAY / WEEKEND / HOLIDAY. Uses the local
 * calendar interpretation via `getUTCDay` since `workDate` is stored as a
 * `Date`-only column and callers must pass midnight-UTC to avoid TZ drift.
 */
export function classifyDay(workDate: Date, holidaySet: ReadonlySet<string>): OvertimeDayKind {
  const iso = toIsoDate(workDate);
  if (holidaySet.has(iso)) return 'HOLIDAY';
  const dow = workDate.getUTCDay(); // 0 = Sun, 6 = Sat
  if (dow === 0 || dow === 6) return 'WEEKEND';
  return 'WEEKDAY';
}

export function computeOvertimeRate(input: RateComputationInput): RateComputationResult {
  const baseRate =
    input.userHourlyRateOverride ??
    input.companyPolicy.hourlyRate ??
    (() => {
      throw new OvertimeRateError('Neither user nor company overtime hourly rate is configured');
    })();

  const dayKind = classifyDay(input.workDate, input.holidaySet);
  const multiplier = pickMultiplier(dayKind, input.companyPolicy);

  // Round rate & total to 2 decimals to match Decimal(12, 2) / Decimal(14, 2).
  const ratePerHour = round2(baseRate * multiplier);
  const totalAmount = round2(input.hours * ratePerHour);

  return { dayKind, baseRate, multiplier, ratePerHour, totalAmount };
}

function pickMultiplier(kind: OvertimeDayKind, p: CompanyOvertimePolicy): number {
  switch (kind) {
    case 'HOLIDAY':
      return p.holidayMultiplier;
    case 'WEEKEND':
      return p.weekendMultiplier;
    case 'WEEKDAY':
      return p.weekdayMultiplier;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
