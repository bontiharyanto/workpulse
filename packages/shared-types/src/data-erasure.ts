import { z } from 'zod';

/**
 * Fase 31b — Right-to-erasure. Mirrors
 * `apps/api/src/data-erasure/dto/data-erasure.dto.ts`.
 */
export const dataErasureStatusSchema = z.enum([
  'PENDING_APPROVAL',
  'APPROVED_SCHEDULED',
  'EXECUTED',
  'REJECTED',
  'CANCELLED',
  'FAILED',
]);
export type DataErasureStatus = z.infer<typeof dataErasureStatusSchema>;

export const dataErasureRequestSchema = z.object({
  id: z.string(),
  status: dataErasureStatusSchema,
  reason: z.string().nullable(),
  requestedAt: z.string(),
  decidedAt: z.string().nullable(),
  decidedById: z.string().nullable(),
  decisionNote: z.string().nullable(),
  scheduledFor: z.string().nullable(),
  executedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  failedAt: z.string().nullable(),
  failureReason: z.string().nullable(),
});
export type DataErasureRequestRow = z.infer<typeof dataErasureRequestSchema>;

export const dataErasureListResponseSchema = z.object({
  requests: z.array(dataErasureRequestSchema),
});
export type DataErasureListResponse = z.infer<
  typeof dataErasureListResponseSchema
>;

/** Admin view is the base row plus the derived requester context. */
export const dataErasureAdminRequestSchema = dataErasureRequestSchema.extend({
  userId: z.string(),
  companyId: z.string(),
  requesterName: z.string(),
  requesterEmail: z.string(),
});
export type DataErasureAdminRequestRow = z.infer<
  typeof dataErasureAdminRequestSchema
>;

export const dataErasureAdminListResponseSchema = z.object({
  requests: z.array(dataErasureAdminRequestSchema),
});
export type DataErasureAdminListResponse = z.infer<
  typeof dataErasureAdminListResponseSchema
>;

// Form inputs
export const createErasureRequestInputSchema = z.object({
  reason: z
    .string()
    .max(1000, 'Alasan maksimal 1000 karakter.')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v)),
});
export type CreateErasureRequestInput = z.infer<
  typeof createErasureRequestInputSchema
>;

export const rejectErasureInputSchema = z.object({
  note: z
    .string()
    .min(1, 'Alasan penolakan wajib diisi.')
    .max(1000, 'Alasan maksimal 1000 karakter.'),
});
export type RejectErasureInput = z.infer<typeof rejectErasureInputSchema>;

export const approveErasureInputSchema = z.object({
  note: z
    .string()
    .max(1000, 'Catatan maksimal 1000 karakter.')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v)),
});
export type ApproveErasureInput = z.infer<typeof approveErasureInputSchema>;
