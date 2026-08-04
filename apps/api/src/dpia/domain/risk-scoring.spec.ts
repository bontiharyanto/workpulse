import { DpiaRiskLevel } from '@prisma/client';

import {
  InvalidRiskAxisError,
  ResidualExceedsInherentError,
  bucketScore,
  deriveRisk,
  levelOf,
  scoreOf,
  summariseResidual,
} from './risk-scoring';

describe('DPIA risk scoring', () => {
  describe('bucketScore', () => {
    it('LOW covers score < 8', () => {
      expect(bucketScore(1)).toBe(DpiaRiskLevel.LOW);
      expect(bucketScore(7)).toBe(DpiaRiskLevel.LOW);
    });
    it('MEDIUM covers 8..14', () => {
      expect(bucketScore(8)).toBe(DpiaRiskLevel.MEDIUM);
      expect(bucketScore(14)).toBe(DpiaRiskLevel.MEDIUM);
    });
    it('HIGH covers 15..19', () => {
      expect(bucketScore(15)).toBe(DpiaRiskLevel.HIGH);
      expect(bucketScore(19)).toBe(DpiaRiskLevel.HIGH);
    });
    it('CRITICAL covers 20..25', () => {
      expect(bucketScore(20)).toBe(DpiaRiskLevel.CRITICAL);
      expect(bucketScore(25)).toBe(DpiaRiskLevel.CRITICAL);
    });
  });

  describe('scoreOf + levelOf', () => {
    it('rejects out-of-range axes', () => {
      expect(() => scoreOf(0, 3)).toThrow(InvalidRiskAxisError);
      expect(() => scoreOf(3, 6)).toThrow(InvalidRiskAxisError);
      expect(() => scoreOf(1.5 as unknown as number, 3)).toThrow(
        InvalidRiskAxisError,
      );
    });
    it('multiplies likelihood and impact', () => {
      expect(scoreOf(2, 3)).toBe(6);
      expect(levelOf(5, 5)).toBe(DpiaRiskLevel.CRITICAL);
    });
  });

  describe('deriveRisk', () => {
    it('rejects residual larger than inherent', () => {
      expect(() =>
        deriveRisk({
          likelihood: 2,
          impact: 3,
          residualLikelihood: 3,
          residualImpact: 3,
        }),
      ).toThrow(ResidualExceedsInherentError);
    });
    it('computes both buckets when valid', () => {
      const d = deriveRisk({
        likelihood: 4,
        impact: 5, // inherent 20 -> CRITICAL
        residualLikelihood: 2,
        residualImpact: 3, // residual 6 -> LOW
      });
      expect(d.inherentScore).toBe(20);
      expect(d.inherentLevel).toBe(DpiaRiskLevel.CRITICAL);
      expect(d.residualScore).toBe(6);
      expect(d.residualLevel).toBe(DpiaRiskLevel.LOW);
    });
  });

  describe('summariseResidual', () => {
    it('LOW for empty register', () => {
      expect(summariseResidual([])).toBe(DpiaRiskLevel.LOW);
    });
    it('takes the worst residual', () => {
      expect(
        summariseResidual([
          { residualLevel: DpiaRiskLevel.LOW },
          { residualLevel: DpiaRiskLevel.HIGH },
          { residualLevel: DpiaRiskLevel.MEDIUM },
        ]),
      ).toBe(DpiaRiskLevel.HIGH);
    });
  });
});
