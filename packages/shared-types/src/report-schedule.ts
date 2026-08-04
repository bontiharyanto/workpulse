import { z } from 'zod';

/**
 * Fase 33c — Scheduled Email Reports wire schemas.
 *
 * Mirrors `apps/api/src/reports/dto/report-schedule.dto.ts`.
 */

export const scheduledReportTypeSchema = z.enum([
  'TIMESHEET_SUMMARY',
  'ROPA',
  'DPIA',
  'ANALYTICS_SNAPSHOT',
  'CUSTOM',
]);
export type ScheduledReportType = z.infer<typeof scheduledReportTypeSchema>;

export const reportFrequencySchema = z.enum(['DAILY', 'WEEKLY', 'MONTHLY']);
export type ReportFrequency = z.infer<typeof reportFrequencySchema>;

export const reportDeliveryStatusSchema = z.enum([
  'PENDING',
  'DISPATCHING',
  'DELIVERED',
  'FAILED',
]);
export type ReportDeliveryStatus = z.infer<typeof reportDeliveryStatusSchema>;

// -----------------------------------------------------------------------------
// Requests
// -----------------------------------------------------------------------------

export const createReportScheduleInputSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    reportType: z.enum([
      'TIMESHEET_SUMMARY',
      'ROPA',
      'DPIA',
      'ANALYTICS_SNAPSHOT',
    ]),
    frequency: reportFrequencySchema,
    cadenceDay: z.number().int().min(0).max(28).optional(),
    cadenceHour: z.number().int().min(0).max(23),
    recipients: z.array(z.string().email()).min(1).max(20),
  })
  .refine(
    (v) => v.frequency === 'DAILY' || v.cadenceDay !== undefined,
    { message: 'WEEKLY/MONTHLY schedules require cadenceDay', path: ['cadenceDay'] },
  )
  .refine(
    (v) =>
      v.frequency !== 'MONTHLY' ||
      (v.cadenceDay !== undefined && v.cadenceDay >= 1 && v.cadenceDay <= 28),
    { message: 'MONTHLY cadenceDay must be 1..28', path: ['cadenceDay'] },
  )
  .refine(
    (v) =>
      v.frequency !== 'WEEKLY' ||
      (v.cadenceDay !== undefined && v.cadenceDay >= 0 && v.cadenceDay <= 6),
    { message: 'WEEKLY cadenceDay must be 0..6 (Sunday=0)', path: ['cadenceDay'] },
  );
export type CreateReportScheduleInput = z.infer<
  typeof createReportScheduleInputSchema
>;

export const updateReportScheduleInputSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  frequency: reportFrequencySchema.optional(),
  cadenceDay: z.number().int().min(0).max(28).optional(),
  cadenceHour: z.number().int().min(0).max(23).optional(),
  recipients: z.array(z.string().email()).max(20).optional(),
  active: z.boolean().optional(),
});
export type UpdateReportScheduleInput = z.infer<
  typeof updateReportScheduleInputSchema
>;

// -----------------------------------------------------------------------------
// Responses
// -----------------------------------------------------------------------------

export const reportScheduleResponseSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  reportType: scheduledReportTypeSchema,
  savedReportId: z.string().nullable(),
  name: z.string(),
  frequency: reportFrequencySchema,
  cadenceDay: z.number().int().nullable(),
  cadenceHour: z.number().int(),
  active: z.boolean(),
  recipients: z.array(z.string()),
  nextRunAt: z.string(),
  lastRunAt: z.string().nullable(),
  createdById: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ReportScheduleResponse = z.infer<
  typeof reportScheduleResponseSchema
>;

export const reportDeliveryResponseSchema = z.object({
  id: z.string(),
  scheduleId: z.string(),
  status: reportDeliveryStatusSchema,
  recipients: z.array(z.string()),
  payloadSha256: z.string().nullable(),
  payloadBytes: z.number().int().nullable(),
  attachmentFilename: z.string().nullable(),
  attempts: z.number().int(),
  lastAttemptAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  errorSnippet: z.string().nullable(),
  createdAt: z.string(),
});
export type ReportDeliveryResponse = z.infer<
  typeof reportDeliveryResponseSchema
>;

export const reportRegistryEntrySchema = z.object({
  type: scheduledReportTypeSchema,
  label: z.string(),
  description: z.string(),
});
export type ReportRegistryEntry = z.infer<typeof reportRegistryEntrySchema>;
