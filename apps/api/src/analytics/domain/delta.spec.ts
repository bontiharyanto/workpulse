import { aggregate, computeDelta } from './delta';

describe('analytics/domain/delta — Fase 33a', () => {
  describe('computeDelta', () => {
    it('flat when values match exactly', () => {
      const d = computeDelta(10, 10, 'HIGHER_IS_BETTER');
      expect(d.absolute).toBe(0);
      expect(d.pct).toBeCloseTo(0);
      expect(d.trend).toBe('FLAT');
    });

    it('HIGHER_IS_BETTER: up is good, down is bad', () => {
      expect(computeDelta(12, 10, 'HIGHER_IS_BETTER').trend).toBe('UP_GOOD');
      expect(computeDelta(8, 10, 'HIGHER_IS_BETTER').trend).toBe('DOWN_BAD');
    });

    it('LOWER_IS_BETTER: down is good, up is bad', () => {
      expect(computeDelta(8, 10, 'LOWER_IS_BETTER').trend).toBe('DOWN_GOOD');
      expect(computeDelta(12, 10, 'LOWER_IS_BETTER').trend).toBe('UP_BAD');
    });

    it('NEUTRAL: any move rendered as GOOD', () => {
      expect(computeDelta(12, 10, 'NEUTRAL').trend).toBe('UP_GOOD');
      expect(computeDelta(8, 10, 'NEUTRAL').trend).toBe('DOWN_GOOD');
    });

    it('returns null pct when previous is zero (avoid divide-by-zero)', () => {
      const d = computeDelta(5, 0, 'HIGHER_IS_BETTER');
      expect(d.absolute).toBe(5);
      expect(d.pct).toBeNull();
      expect(d.trend).toBe('UP_GOOD');
    });

    it('correct pct fraction for typical growth', () => {
      const d = computeDelta(15, 10, 'HIGHER_IS_BETTER');
      expect(d.absolute).toBe(5);
      expect(d.pct).toBeCloseTo(0.5); // +50%
    });
  });

  describe('aggregate', () => {
    it('SUM adds every element', () => {
      expect(aggregate([1, 2, 3], 'SUM')).toBe(6);
      expect(aggregate([], 'SUM')).toBe(0);
    });

    it('AVG averages non-empty arrays; empty returns 0', () => {
      expect(aggregate([2, 4, 6], 'AVG')).toBe(4);
      expect(aggregate([], 'AVG')).toBe(0);
    });

    it('LAST returns the last element; empty returns 0', () => {
      expect(aggregate([10, 20, 30], 'LAST')).toBe(30);
      expect(aggregate([], 'LAST')).toBe(0);
    });
  });
});
