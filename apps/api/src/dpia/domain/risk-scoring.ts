import { DpiaRiskLevel } from '@prisma/client';

/**
 * Fase 31e — pure risk-scoring math.
 *
 * The grid is a 1..5 × 1..5 matrix — likelihood on one axis, impact on
 * the other. The raw score is `likelihood × impact` (1..25). We bucket
 * into a four-level qualitative scale so the DPO doesn't have to hunt
 * for a specific number in the risk register.
 *
 * Boundaries:
 *   LOW      score < 8
 *   MEDIUM   8 ≤ score ≤ 14
 *   HIGH     15 ≤ score ≤ 19
 *   CRITICAL score ≥ 20
 *
 * These thresholds match ENISA's DPIA guidance for public-sector
 * assessments. Tenants that want a different scale must be handled by
 * a per-tenant override table — deliberately out of scope for 31e.
 */

const AXIS_MIN = 1;
const AXIS_MAX = 5;

export class InvalidRiskAxisError extends Error {
  constructor(axis: 'likelihood' | 'impact', value: number) {
    super(`${axis} must be an integer in [${AXIS_MIN}..${AXIS_MAX}], got ${value}`);
    this.name = 'InvalidRiskAxisError';
  }
}

export class ResidualExceedsInherentError extends Error {
  constructor(axis: 'likelihood' | 'impact', inherent: number, residual: number) {
    super(
      `residual ${axis} (${residual}) must be ≤ inherent ${axis} (${inherent}) — mitigations cannot make a risk worse`,
    );
    this.name = 'ResidualExceedsInherentError';
  }
}

function assertOnAxis(axis: 'likelihood' | 'impact', v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < AXIS_MIN || v > AXIS_MAX) {
    throw new InvalidRiskAxisError(axis, v as number);
  }
  return v;
}

/**
 * Bucket a raw score into a level. The whole DPIA module reads back
 * `DpiaRiskLevel` via this function so we never re-implement the
 * bucketing at a call site.
 */
export function bucketScore(score: number): DpiaRiskLevel {
  if (score < 8) return DpiaRiskLevel.LOW;
  if (score <= 14) return DpiaRiskLevel.MEDIUM;
  if (score <= 19) return DpiaRiskLevel.HIGH;
  return DpiaRiskLevel.CRITICAL;
}

export function scoreOf(likelihood: number, impact: number): number {
  return assertOnAxis('likelihood', likelihood) * assertOnAxis('impact', impact);
}

export function levelOf(likelihood: number, impact: number): DpiaRiskLevel {
  return bucketScore(scoreOf(likelihood, impact));
}

export interface RiskInputs {
  likelihood: number;
  impact: number;
  residualLikelihood: number;
  residualImpact: number;
}

export interface RiskDerived {
  inherentScore: number;
  inherentLevel: DpiaRiskLevel;
  residualScore: number;
  residualLevel: DpiaRiskLevel;
}

/**
 * Validate + derive both inherent and residual scores in one call.
 * Throws `InvalidRiskAxisError` on out-of-range and
 * `ResidualExceedsInherentError` on residual > inherent.
 */
export function deriveRisk(inputs: RiskInputs): RiskDerived {
  const { likelihood, impact, residualLikelihood, residualImpact } = inputs;
  const inherentScore = scoreOf(likelihood, impact);
  const residualScore = scoreOf(residualLikelihood, residualImpact);
  if (residualLikelihood > likelihood) {
    throw new ResidualExceedsInherentError('likelihood', likelihood, residualLikelihood);
  }
  if (residualImpact > impact) {
    throw new ResidualExceedsInherentError('impact', impact, residualImpact);
  }
  return {
    inherentScore,
    inherentLevel: bucketScore(inherentScore),
    residualScore,
    residualLevel: bucketScore(residualScore),
  };
}

/**
 * Roll-up for the "assessment summary" tile: highest residual level
 * across all items on an assessment. Returns `LOW` for an empty
 * register — the DPO gets a green tile until they enter at least one
 * risk (matches ENISA "no residual risk identified" convention).
 */
export function summariseResidual(items: Array<{ residualLevel: DpiaRiskLevel }>): DpiaRiskLevel {
  if (items.length === 0) return DpiaRiskLevel.LOW;
  const rank: Record<DpiaRiskLevel, number> = {
    LOW: 0,
    MEDIUM: 1,
    HIGH: 2,
    CRITICAL: 3,
  };
  let worst: DpiaRiskLevel = DpiaRiskLevel.LOW;
  for (const it of items) {
    if (rank[it.residualLevel] > rank[worst]) worst = it.residualLevel;
  }
  return worst;
}
