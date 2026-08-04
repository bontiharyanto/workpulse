import { z } from 'zod';

/**
 * Fase 31e — Data Protection Impact Assessment (DPIA).
 *
 * Wire schemas for `/admin/dpia/*`. Mirror
 * `apps/api/src/dpia/dto/dpia.dto.ts` + mapper output.
 */

export const dpiaStatusSchema = z.enum([
  'DRAFT',
  'REVIEW',
  'APPROVED',
  'ARCHIVED',
]);
export type DpiaStatus = z.infer<typeof dpiaStatusSchema>;

export const dpiaRiskLevelSchema = z.enum([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);
export type DpiaRiskLevel = z.infer<typeof dpiaRiskLevelSchema>;

// -----------------------------------------------------------------------------
// Response
// -----------------------------------------------------------------------------

export const dpiaRiskItemResponseSchema = z.object({
  id: z.string(),
  ordinal: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
  likelihood: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  inherentScore: z.number().int().min(1).max(25),
  inherentLevel: dpiaRiskLevelSchema,
  mitigations: z.string(),
  residualLikelihood: z.number().int().min(1).max(5),
  residualImpact: z.number().int().min(1).max(5),
  residualScore: z.number().int().min(1).max(25),
  residualLevel: dpiaRiskLevelSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DpiaRiskItemResponse = z.infer<typeof dpiaRiskItemResponseSchema>;

export const dpiaAssessmentResponseSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  ropaActivityId: z.string(),
  status: dpiaStatusSchema,
  title: z.string(),
  scope: z.string(),
  necessity: z.string(),
  dpoOpinion: z.string().nullable(),
  conclusion: z.string().nullable(),
  createdById: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  reviewedById: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  approvedById: z.string().nullable(),
  approvedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  riskItems: z.array(dpiaRiskItemResponseSchema),
  summaryResidualLevel: dpiaRiskLevelSchema,
});
export type DpiaAssessmentResponse = z.infer<
  typeof dpiaAssessmentResponseSchema
>;

export const dpiaAssessmentListItemSchema = z.object({
  id: z.string(),
  ropaActivityId: z.string(),
  ropaActivitySlug: z.string(),
  ropaActivityName: z.string().nullable(),
  status: dpiaStatusSchema,
  title: z.string(),
  summaryResidualLevel: dpiaRiskLevelSchema,
  riskItemCount: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type DpiaAssessmentListItem = z.infer<
  typeof dpiaAssessmentListItemSchema
>;

// -----------------------------------------------------------------------------
// Requests
// -----------------------------------------------------------------------------

const trimmed = (min: number, max: number) =>
  z.string().trim().min(min).max(max);

export const createDpiaAssessmentInputSchema = z.object({
  ropaActivityId: z.string().trim().min(1),
  title: trimmed(4, 200),
  scope: trimmed(20, 4000),
  necessity: trimmed(20, 4000),
  dpoOpinion: z.string().trim().max(4000).optional(),
});
export type CreateDpiaAssessmentInput = z.infer<
  typeof createDpiaAssessmentInputSchema
>;

export const updateDpiaAssessmentInputSchema = z.object({
  title: trimmed(4, 200).optional(),
  scope: trimmed(20, 4000).optional(),
  necessity: trimmed(20, 4000).optional(),
  dpoOpinion: z.string().trim().max(4000).nullable().optional(),
  conclusion: z.string().trim().max(4000).nullable().optional(),
});
export type UpdateDpiaAssessmentInput = z.infer<
  typeof updateDpiaAssessmentInputSchema
>;

export const createDpiaRiskItemInputSchema = z.object({
  title: trimmed(4, 200),
  description: trimmed(10, 4000),
  likelihood: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  mitigations: trimmed(10, 4000),
  residualLikelihood: z.number().int().min(1).max(5),
  residualImpact: z.number().int().min(1).max(5),
});
export type CreateDpiaRiskItemInput = z.infer<
  typeof createDpiaRiskItemInputSchema
>;

export const updateDpiaRiskItemInputSchema = z.object({
  title: trimmed(4, 200).optional(),
  description: trimmed(10, 4000).optional(),
  likelihood: z.number().int().min(1).max(5).optional(),
  impact: z.number().int().min(1).max(5).optional(),
  mitigations: trimmed(10, 4000).optional(),
  residualLikelihood: z.number().int().min(1).max(5).optional(),
  residualImpact: z.number().int().min(1).max(5).optional(),
});
export type UpdateDpiaRiskItemInput = z.infer<
  typeof updateDpiaRiskItemInputSchema
>;
