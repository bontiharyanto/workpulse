/**
 * "HH:mm" time-of-day utilities. Pure, timezone-agnostic. Cross-midnight shifts
 * are represented by `endTime < startTime` and handled by `shiftDurationMinutes`.
 */

const HH_MM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/u;

export type HHMM = string & { readonly __brand: 'HHMM' };

export function isHHMM(v: string): v is HHMM {
  return HH_MM_RE.test(v);
}

export function assertHHMM(v: string): asserts v is HHMM {
  if (!isHHMM(v)) {
    throw new RangeError(`invalid HH:mm value: ${v}`);
  }
}

/** Minutes since 00:00 for `HH:mm`. */
export function toMinutes(v: string): number {
  assertHHMM(v);
  const parts = v.split(':').map((s) => Number.parseInt(s, 10));
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  return h * 60 + m;
}

/** True when the shift crosses midnight (e.g. 22:00 → 06:00). */
export function crossesMidnight(start: string, end: string): boolean {
  return toMinutes(end) <= toMinutes(start);
}

/**
 * Duration in minutes between two `HH:mm` values, treating `endTime <= startTime`
 * as a cross-midnight shift.
 * A zero-length shift (start === end) is rejected as an invariant violation.
 */
export function shiftDurationMinutes(start: string, end: string): number {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) {
    throw new RangeError('shift start and end must differ');
  }
  return e > s ? e - s : 24 * 60 - s + e;
}
