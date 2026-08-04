import type { DpiaAssessment, DpiaRiskItem } from '@prisma/client';

import { scoreOf, summariseResidual } from './domain/risk-scoring';
import type {
  DpiaAssessmentListItemDto,
  DpiaAssessmentResponseDto,
  DpiaRiskItemResponseDto,
} from './dto/dpia.dto';

type WithItems = DpiaAssessment & { riskItems: DpiaRiskItem[] };

/**
 * Fase 31e — Prisma → DTO mappers.
 *
 * Response shape mirrors the FE risk-register renderer: raw scores are
 * kept alongside their bucket so FE code can re-render the 5×5 matrix
 * heat map without re-fetching the DB.
 */
export function toRiskItemDto(item: DpiaRiskItem): DpiaRiskItemResponseDto {
  return {
    id: item.id,
    ordinal: item.ordinal,
    title: item.title,
    description: item.description,
    likelihood: item.likelihood,
    impact: item.impact,
    inherentScore: scoreOf(item.likelihood, item.impact),
    inherentLevel: item.inherentLevel,
    mitigations: item.mitigations,
    residualLikelihood: item.residualLikelihood,
    residualImpact: item.residualImpact,
    residualScore: scoreOf(item.residualLikelihood, item.residualImpact),
    residualLevel: item.residualLevel,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function toAssessmentDto(a: WithItems): DpiaAssessmentResponseDto {
  return {
    id: a.id,
    companyId: a.companyId,
    ropaActivityId: a.ropaActivityId,
    status: a.status,
    title: a.title,
    scope: a.scope,
    necessity: a.necessity,
    dpoOpinion: a.dpoOpinion,
    conclusion: a.conclusion,
    createdById: a.createdById,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    reviewedById: a.reviewedById,
    reviewedAt: a.reviewedAt?.toISOString() ?? null,
    approvedById: a.approvedById,
    approvedAt: a.approvedAt?.toISOString() ?? null,
    archivedAt: a.archivedAt?.toISOString() ?? null,
    riskItems: a.riskItems.map(toRiskItemDto),
    summaryResidualLevel: summariseResidual(a.riskItems),
  };
}

export function toListItemDto(
  a: WithItems & {
    ropaActivity: { slug: string; currentVersion: { name: string } | null };
  },
): DpiaAssessmentListItemDto {
  return {
    id: a.id,
    ropaActivityId: a.ropaActivityId,
    ropaActivitySlug: a.ropaActivity.slug,
    ropaActivityName: a.ropaActivity.currentVersion?.name ?? null,
    status: a.status,
    title: a.title,
    summaryResidualLevel: summariseResidual(a.riskItems),
    riskItemCount: a.riskItems.length,
    updatedAt: a.updatedAt.toISOString(),
  };
}
