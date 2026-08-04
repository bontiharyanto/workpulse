import { ageInDays, bucketFor, emptyBucketCounts, summarize } from './age-buckets';

const NOW = new Date('2026-08-02T12:00:00Z');

function daysAgo(n: number, hoursOffset = 0): Date {
  return new Date(NOW.getTime() - (n * 24 + hoursOffset) * 60 * 60 * 1000);
}

describe('ageInDays', () => {
  it('returns 0 for a row just created', () => {
    expect(ageInDays(NOW, NOW)).toBe(0);
  });

  it('returns 0 when the diff is 23h59m (floor semantics)', () => {
    expect(ageInDays(daysAgo(0, 23.99), NOW)).toBe(0);
  });

  it('returns 1 at exactly 24 hours', () => {
    expect(ageInDays(daysAgo(1), NOW)).toBe(1);
  });

  it('returns 0 for a future createdAt (clock skew guard)', () => {
    const future = new Date(NOW.getTime() + 60 * 60 * 1000);
    expect(ageInDays(future, NOW)).toBe(0);
  });
});

describe('bucketFor', () => {
  it.each([
    [0, 'd0_1'],
    [1, 'd1_3'],
    [2, 'd1_3'],
    [3, 'd3_7'],
    [6, 'd3_7'],
    [7, 'd7_plus'],
    [42, 'd7_plus'],
  ] as const)('age=%s → %s', (age, bucket) => {
    expect(bucketFor(age)).toBe(bucket);
  });
});

describe('summarize', () => {
  it('produces zeroed counts on an empty list', () => {
    expect(summarize([], NOW, 3)).toEqual({
      total: 0,
      fresh: 0,
      stale: 0,
      buckets: emptyBucketCounts(),
    });
  });

  it('classifies a mixed list into fresh vs stale by the threshold', () => {
    const list = [
      daysAgo(0), // fresh
      daysAgo(2), // fresh
      daysAgo(3), // stale (threshold=3 → 3+ is stale)
      daysAgo(5), // stale
      daysAgo(10), // stale
    ];
    const out = summarize(list, NOW, 3);
    expect(out.total).toBe(5);
    expect(out.fresh).toBe(2);
    expect(out.stale).toBe(3);
    expect(out.buckets).toEqual({ d0_1: 1, d1_3: 1, d3_7: 2, d7_plus: 1 });
  });

  it('respects a raised threshold (staleAfterDays = 7)', () => {
    const list = [daysAgo(0), daysAgo(4), daysAgo(6), daysAgo(9)];
    const out = summarize(list, NOW, 7);
    expect(out.fresh).toBe(3); // 0/4/6 all < 7
    expect(out.stale).toBe(1); // only 9d
    // The bucket distribution is INDEPENDENT of threshold.
    expect(out.buckets).toEqual({ d0_1: 1, d1_3: 0, d3_7: 2, d7_plus: 1 });
  });
});
