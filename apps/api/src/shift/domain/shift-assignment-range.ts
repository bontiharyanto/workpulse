/**
 * Shift assignments occupy a half-open calendar interval `[effectiveFrom, effectiveTo)`.
 * An open-ended assignment (still active) has `effectiveTo = null` which represents
 * `+Infinity`.
 *
 * Two assignments A and B overlap iff:
 *   A.from < B.to  AND  B.from < A.to
 *
 * with a null `to` treated as +∞.
 *
 * These helpers are pure so they can be used both by the service (validating a
 * candidate assignment before insert) and by unit tests.
 */

export interface AssignmentRange {
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null;
}

/**
 * True when `candidate` overlaps any of `existing`. Comparison ignores an entry
 * whose id matches `ignoreId` (useful when updating an existing assignment).
 */
export function hasOverlappingAssignment(
  candidate: AssignmentRange,
  existing: ReadonlyArray<AssignmentRange & { id?: string }>,
  ignoreId?: string,
): boolean {
  return existing.some((row) => {
    if (row.id !== undefined && ignoreId !== undefined && row.id === ignoreId) return false;
    return rangesOverlap(candidate, row);
  });
}

export function rangesOverlap(a: AssignmentRange, b: AssignmentRange): boolean {
  const aFrom = a.effectiveFrom;
  const aTo = a.effectiveTo; // null = +∞
  const bFrom = b.effectiveFrom;
  const bTo = b.effectiveTo;

  // a.from < b.to
  const cond1 = bTo === null ? true : aFrom < bTo;
  // b.from < a.to
  const cond2 = aTo === null ? true : bFrom < aTo;
  return cond1 && cond2;
}
