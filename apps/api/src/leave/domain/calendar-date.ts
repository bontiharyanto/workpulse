/**
 * "YYYY-MM-DD" — a company-local calendar day, timezone-agnostic.
 * Used for leave request boundaries. Never coerced to a Date/JS timezone
 * inside domain logic — comparisons are lexicographic on the ISO date string.
 */
export type CalendarDate = string;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function assertCalendarDate(value: string): asserts value is CalendarDate {
  const match = ISO_DATE_RE.exec(value);
  if (!match) {
    throw new RangeError(`Not a YYYY-MM-DD calendar date: ${value}`);
  }
  const [, ys, ms, ds] = match;
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    throw new RangeError(`Not a valid calendar date: ${value}`);
  }
  // Guard against 2024-02-31 etc. by roundtripping through Date.UTC.
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) {
    throw new RangeError(`Not a valid calendar date: ${value}`);
  }
}

/** Returns the day of week (0=Sun, 6=Sat) for a calendar date using UTC math. */
export function dayOfWeek(date: CalendarDate): number {
  assertCalendarDate(date);
  const [ys, ms, ds] = date.split('-');
  return new Date(Date.UTC(Number(ys), Number(ms) - 1, Number(ds))).getUTCDay();
}

/** Inclusive iterator: yields every calendar date from `start` to `end`. */
export function* eachDay(start: CalendarDate, end: CalendarDate): Iterable<CalendarDate> {
  assertCalendarDate(start);
  assertCalendarDate(end);
  if (end < start) return;

  const [ys, ms, ds] = start.split('-').map(Number) as [number, number, number];
  const cursor = new Date(Date.UTC(ys, ms - 1, ds));
  const endParts = end.split('-').map(Number) as [number, number, number];
  const endUtc = Date.UTC(endParts[0], endParts[1] - 1, endParts[2]);

  while (cursor.getTime() <= endUtc) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cursor.getUTCDate()).padStart(2, '0');
    yield `${y}-${m}-${d}`;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}
