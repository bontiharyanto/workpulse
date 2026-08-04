import { TimesheetPeriodType, WeekStartDay } from '@prisma/client';

/**
 * Slim view of `TimesheetConfig` used by the period calculator. Kept as
 * a pure interface (not the Prisma model) so callers can exercise it
 * from unit tests without any DB round-trips.
 */
export interface PeriodCalculatorConfig {
  periodType: TimesheetPeriodType;
  weekStartDay: WeekStartDay;
  /** Only used by BIWEEKLY. Calendar date (any time-of-day) — we snap it to midnight in `timezone`. */
  biweeklyAnchor: Date | null;
  /** Only used by CUTOFF. 1..28. */
  cutoffDayOfMonth: number | null;
  /** IANA timezone, e.g. "Asia/Jakarta". */
  timezone: string;
}

export interface CalculatedPeriod {
  /** Calendar date (00:00:00 UTC of the start day). */
  periodStart: Date;
  /** Calendar date (00:00:00 UTC of the end day, inclusive). */
  periodEnd: Date;
  /** Human-readable label, e.g. "Aug 2026", "W32 2026", "26 Jul – 25 Aug 2026". */
  label: string;
}

/**
 * Resolve the timesheet period containing the given instant, honouring
 * the tenant timezone. Returns pure UTC-midnight `Date`s so downstream
 * code can compare them without any tz gymnastics.
 *
 * All four `TimesheetPeriodType` variants are supported:
 *   - WEEKLY   → 7-day window anchored at `weekStartDay`.
 *   - BIWEEKLY → 14-day window anchored at `biweeklyAnchor`.
 *                Falls back to `weekStartDay` semantics when the anchor
 *                is missing (matches the FE default).
 *   - MONTHLY  → 1..last-of-month in tenant timezone.
 *   - CUTOFF   → (prev-cutoff+1)..cutoff in tenant timezone. Requires
 *                `cutoffDayOfMonth` in [1, 28].
 *
 * Contract:
 *   - `periodStart` and `periodEnd` are both `00:00:00 UTC` on the target
 *     calendar day. The window is **inclusive at both ends**.
 *   - Never throws for a valid config. Passing an out-of-range
 *     `cutoffDayOfMonth` throws a `RangeError`.
 */
export function calculatePeriod(now: Date, config: PeriodCalculatorConfig): CalculatedPeriod {
  switch (config.periodType) {
    case TimesheetPeriodType.WEEKLY:
      return weeklyPeriod(now, config);
    case TimesheetPeriodType.BIWEEKLY:
      return biweeklyPeriod(now, config);
    case TimesheetPeriodType.MONTHLY:
      return monthlyPeriod(now, config);
    case TimesheetPeriodType.CUTOFF:
      return cutoffPeriod(now, config);
    default: {
      const exhaustive: never = config.periodType;
      throw new Error(`unsupported period type: ${String(exhaustive)}`);
    }
  }
}

// ---------- WEEKLY ----------

function weeklyPeriod(now: Date, config: PeriodCalculatorConfig): CalculatedPeriod {
  const localDate = tzCalendarDate(now, config.timezone);
  const weekdayInTz = tzWeekday(now, config.timezone);
  const anchorWeekday = config.weekStartDay === WeekStartDay.SUNDAY ? 0 : 1;

  const daysSinceAnchor = (weekdayInTz - anchorWeekday + 7) % 7;
  const start = addDaysUtc(localDate, -daysSinceAnchor);
  const end = addDaysUtc(start, 6);

  const isoWeek = isoWeekNumber(start);
  const year = start.getUTCFullYear();
  const label = `W${String(isoWeek).padStart(2, '0')} ${year}`;
  return { periodStart: start, periodEnd: end, label };
}

// ---------- BIWEEKLY ----------

function biweeklyPeriod(now: Date, config: PeriodCalculatorConfig): CalculatedPeriod {
  // Fallback: when no anchor is set, treat this as weekly-of-2. We use
  // the beginning of the ISO week (Monday) of the earliest supported
  // date (2000-01-03) as an implicit anchor so the period boundaries
  // stay stable across process restarts.
  const anchor = config.biweeklyAnchor ?? new Date(Date.UTC(2000, 0, 3)); // 2000-01-03 was a Monday

  const anchorUtcMidnight = tzCalendarDate(anchor, config.timezone);
  const localDate = tzCalendarDate(now, config.timezone);
  const daysBetween = Math.floor((localDate.getTime() - anchorUtcMidnight.getTime()) / 86_400_000);
  // Use Math.floor over `daysBetween / 14` (works for negative values).
  const periodsSinceAnchor = Math.floor(daysBetween / 14);
  const start = addDaysUtc(anchorUtcMidnight, periodsSinceAnchor * 14);
  const end = addDaysUtc(start, 13);

  const label = `${formatShortDate(start)} – ${formatShortDate(end)}`;
  return { periodStart: start, periodEnd: end, label };
}

// ---------- MONTHLY ----------

function monthlyPeriod(now: Date, config: PeriodCalculatorConfig): CalculatedPeriod {
  const parts = tzCalendarParts(now, config.timezone);
  const start = new Date(Date.UTC(parts.year, parts.month, 1));
  const end = new Date(Date.UTC(parts.year, parts.month + 1, 0));
  const label = MONTH_LABELS[parts.month] + ' ' + String(parts.year);
  return { periodStart: start, periodEnd: end, label };
}

// ---------- CUTOFF ----------

function cutoffPeriod(now: Date, config: PeriodCalculatorConfig): CalculatedPeriod {
  const cutoff = config.cutoffDayOfMonth;
  if (cutoff === null || cutoff === undefined) {
    throw new Error('TimesheetConfig.periodType=CUTOFF but cutoffDayOfMonth is null');
  }
  if (!Number.isInteger(cutoff) || cutoff < 1 || cutoff > 28) {
    throw new RangeError(`cutoffDayOfMonth must be an integer in [1, 28]; got ${cutoff}`);
  }

  const parts = tzCalendarParts(now, config.timezone);

  // Are we in the "closing" segment (day <= cutoff) or the "opening"
  // segment (day > cutoff, i.e. the next period has begun)?
  if (parts.day <= cutoff) {
    const start = new Date(Date.UTC(parts.year, parts.month - 1, cutoff + 1));
    const end = new Date(Date.UTC(parts.year, parts.month, cutoff));
    return { periodStart: start, periodEnd: end, label: cutoffLabel(start, end) };
  }

  const start = new Date(Date.UTC(parts.year, parts.month, cutoff + 1));
  const end = new Date(Date.UTC(parts.year, parts.month + 1, cutoff));
  return { periodStart: start, periodEnd: end, label: cutoffLabel(start, end) };
}

// ---------- helpers ----------

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function formatShortDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function cutoffLabel(start: Date, end: Date): string {
  return `${start.getUTCDate()} ${MONTH_LABELS[start.getUTCMonth()]} – ${end.getUTCDate()} ${MONTH_LABELS[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
}

function addDaysUtc(day: Date, delta: number): Date {
  const next = new Date(day.getTime());
  next.setUTCDate(next.getUTCDate() + delta);
  return next;
}

/**
 * Snap the given instant to the start (00:00:00) of its calendar day in
 * `timezone`. Returns a UTC-midnight Date whose civil calendar in
 * `timezone` equals the target day.
 */
function tzCalendarDate(instant: Date, timezone: string): Date {
  const parts = tzCalendarParts(instant, timezone);
  return new Date(Date.UTC(parts.year, parts.month, parts.day));
}

function tzCalendarParts(
  instant: Date,
  timezone: string,
): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(instant).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month) - 1,
    day: Number(parts.day),
  };
}

function tzWeekday(instant: Date, timezone: string): number {
  // Intl "weekday: short" doesn't map cleanly to 0..6; use en-US "narrow".
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  });
  const short = dtf.format(instant);
  switch (short) {
    case 'Sun':
      return 0;
    case 'Mon':
      return 1;
    case 'Tue':
      return 2;
    case 'Wed':
      return 3;
    case 'Thu':
      return 4;
    case 'Fri':
      return 5;
    case 'Sat':
      return 6;
    default:
      throw new Error(`unexpected weekday: ${short}`);
  }
}

/**
 * ISO 8601 week number for a UTC-midnight date. Used to label WEEKLY
 * periods without introducing a moment/luxon dependency.
 */
function isoWeekNumber(day: Date): number {
  const d = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}
