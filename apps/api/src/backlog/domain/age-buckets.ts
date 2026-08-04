/**
 * Age-bucketing for pending approvals.
 *
 * Kept framework-free so bucket assignment can be unit-tested without
 * DB round-trips. The buckets are chosen to mirror how HR / operations
 * actually think about backlog:
 *
 *   - `d0_1`  (0–24h)   → "fresh, doesn't need attention yet"
 *   - `d1_3`  (1–3 d)   → "in-flight, normal for supervisor turnaround"
 *   - `d3_7`  (3–7 d)   → "stale, HR should nudge"
 *   - `d7_plus` (7 d+)  → "rotting, escalate"
 *
 * The threshold `staleAfterDays` (defaults to 3) determines the
 * fresh-vs-stale split used by the count summary — deliberately separate
 * from the bucket boundaries so the caller can raise/lower "stale"
 * without breaking the histogram.
 *
 * Boundaries are half-open on the LOWER side (inclusive) and open on the
 * UPPER side (exclusive), so a row created exactly N days ago lands in
 * the bucket that starts at N days. Prevents rows from double-counting.
 */

export type BacklogAgeBucket = 'd0_1' | 'd1_3' | 'd3_7' | 'd7_plus';

export interface BucketCounts {
  d0_1: number;
  d1_3: number;
  d3_7: number;
  d7_plus: number;
}

export function emptyBucketCounts(): BucketCounts {
  return { d0_1: 0, d1_3: 0, d3_7: 0, d7_plus: 0 };
}

/**
 * Age in whole days between two timestamps (UTC-agnostic — it's a duration).
 * Uses floor semantics: 23h50m → 0, 24h → 1, so a row exactly one day
 * old is classified as "1 day old", not "0".
 */
export function ageInDays(createdAt: Date, now: Date): number {
  const diffMs = now.getTime() - createdAt.getTime();
  if (diffMs < 0) return 0; // clock skew guard — treat future-dated rows as brand-new
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

export function bucketFor(ageDays: number): BacklogAgeBucket {
  if (ageDays < 1) return 'd0_1';
  if (ageDays < 3) return 'd1_3';
  if (ageDays < 7) return 'd3_7';
  return 'd7_plus';
}

/**
 * Split a list of `createdAt` timestamps into (fresh, stale, buckets).
 *
 * Chosen over "let SQL do it with CASE WHEN" because:
 *   1. Test isolation — no need to mock a raw query.
 *   2. Postgres date arithmetic can drift on DST-sensitive columns; we
 *      already have millisecond precision in Node, use it.
 *   3. The list is bounded (~100s across three tables per tenant) so
 *      the CPU cost is trivial.
 */
export function summarize(
  createdAtList: readonly Date[],
  now: Date,
  staleAfterDays: number,
): {
  total: number;
  fresh: number;
  stale: number;
  buckets: BucketCounts;
} {
  const buckets = emptyBucketCounts();
  let fresh = 0;
  let stale = 0;
  for (const ts of createdAtList) {
    const days = ageInDays(ts, now);
    buckets[bucketFor(days)]++;
    if (days < staleAfterDays) fresh++;
    else stale++;
  }
  return { total: createdAtList.length, fresh, stale, buckets };
}
