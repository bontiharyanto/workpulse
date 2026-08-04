/**
 * Date helpers that speak the same "YYYY-MM-DD" language the API expects.
 * Kept intentionally dumb — no Luxon / date-fns — so the E2E workspace
 * doesn't drag in a date library just for two format calls.
 */

export function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Returns YYYY-MM-DD for `today + offsetDays`, in UTC. */
export function daysFromToday(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return toIsoDate(d);
}

/**
 * Finds the nearest past weekday (Mon–Fri) at least `minDaysAgo` behind
 * today. Overtime tests use this so the workDate is always a plausible
 * business day inside the submit window.
 */
export function nearestPastWeekday(minDaysAgo = 1): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - minDaysAgo);
  // 0 = Sunday, 6 = Saturday — walk backward until Mon–Fri.
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return toIsoDate(d);
}
