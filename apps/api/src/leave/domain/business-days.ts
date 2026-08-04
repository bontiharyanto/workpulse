import type { CalendarDate } from './calendar-date';
import { dayOfWeek, eachDay } from './calendar-date';

export interface BusinessDaysOptions {
  /** Sunday=0..Saturday=6. Default: Sat & Sun (5, 6). */
  weekendDays?: readonly number[];
  /** ISO date strings ('YYYY-MM-DD') that count as company holidays. */
  holidays?: readonly CalendarDate[];
}

const DEFAULT_WEEKEND = [0, 6] as const; // Sun, Sat

/**
 * Count working days between two calendar dates (INCLUSIVE both ends),
 * excluding weekends and provided holidays.
 *
 * Pure function — no timezone conversions, no I/O.
 */
export function countBusinessDays(
  start: CalendarDate,
  end: CalendarDate,
  options: BusinessDaysOptions = {},
): number {
  if (end < start) return 0;
  const weekend = new Set(options.weekendDays ?? DEFAULT_WEEKEND);
  const holidays = new Set(options.holidays ?? []);

  let count = 0;
  for (const date of eachDay(start, end)) {
    if (weekend.has(dayOfWeek(date))) continue;
    if (holidays.has(date)) continue;
    count += 1;
  }
  return count;
}
