import { z } from 'zod';

/**
 * Fase 31c — Retention policy. Mirrors
 * `apps/api/src/retention/dto/retention.dto.ts`.
 *
 * Ranges are duplicated here so the FE form can bound its inputs
 * without a round-trip. They match `RETENTION_BOUNDS` in
 * `apps/api/src/retention/retention.service.ts`.
 */
export const retentionBounds = {
  notification: { min: 0, max: 730 },
  dataExport: { min: 1, max: 168 },
  terminatedUser: { min: 0, max: 3650 },
} as const;

export const retentionPolicySchema = z.object({
  id: z.string(),
  companyId: z.string(),
  notificationRetentionDays: z.number().int(),
  dataExportArchiveRetentionHours: z.number().int(),
  terminatedUserAnonymizeDays: z.number().int(),
  updatedAt: z.string(),
  updatedById: z.string().nullable(),
});
export type RetentionPolicyDto = z.infer<typeof retentionPolicySchema>;

export const updateRetentionPolicyInputSchema = z.object({
  notificationRetentionDays: z
    .number()
    .int()
    .min(retentionBounds.notification.min)
    .max(retentionBounds.notification.max)
    .optional(),
  dataExportArchiveRetentionHours: z
    .number()
    .int()
    .min(retentionBounds.dataExport.min)
    .max(retentionBounds.dataExport.max)
    .optional(),
  terminatedUserAnonymizeDays: z
    .number()
    .int()
    .min(retentionBounds.terminatedUser.min)
    .max(retentionBounds.terminatedUser.max)
    .optional(),
});
export type UpdateRetentionPolicyInput = z.infer<typeof updateRetentionPolicyInputSchema>;

// ---------------------------------------------------------------------------
// OPS-6 — Retention Enforcement Audit
// ---------------------------------------------------------------------------

export const retentionAuditStatusSchema = z.enum(['SUCCESS', 'GAP_DETECTED', 'WORKER_INACTIVE']);
export type RetentionAuditStatus = z.infer<typeof retentionAuditStatusSchema>;

export const retentionAuditFindingKindSchema = z.enum([
  'notifications_past_retention',
  'dsar_archives_past_retention',
  'terminated_users_past_retention',
  'worker_inactive_during_period',
]);
export type RetentionAuditFindingKind = z.infer<typeof retentionAuditFindingKindSchema>;

export const retentionAuditFindingSchema = z.object({
  kind: retentionAuditFindingKindSchema,
  severity: z.enum(['info', 'warning', 'critical']),
  count: z.number().int().optional(),
  message: z.string(),
});
export type RetentionAuditFinding = z.infer<typeof retentionAuditFindingSchema>;

export const retentionAuditPolicySnapshotSchema = z.object({
  notificationRetentionDays: z.number().int(),
  dataExportArchiveRetentionHours: z.number().int(),
  terminatedUserAnonymizeDays: z.number().int(),
});
export type RetentionAuditPolicySnapshot = z.infer<typeof retentionAuditPolicySnapshotSchema>;

export const retentionAuditReportSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  generatedAt: z.string(),
  status: retentionAuditStatusSchema,
  notificationsPruned: z.number().int(),
  usersAutoAnonymised: z.number().int(),
  dsarArchivesExpired: z.number().int(),
  notificationsPastRetention: z.number().int(),
  dsarArchivesPastRetention: z.number().int(),
  terminatedUsersPastRetention: z.number().int(),
  policySnapshot: retentionAuditPolicySnapshotSchema,
  workerLastRunAt: z.string().nullable(),
  findings: z.array(retentionAuditFindingSchema),
  notes: z.string().nullable(),
});
export type RetentionAuditReportDto = z.infer<typeof retentionAuditReportSchema>;

export const retentionAuditListResponseSchema = z.object({
  rows: z.array(retentionAuditReportSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type RetentionAuditListResponseDto = z.infer<typeof retentionAuditListResponseSchema>;

export const regenerateRetentionAuditInputSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});
export type RegenerateRetentionAuditInput = z.infer<typeof regenerateRetentionAuditInputSchema>;
