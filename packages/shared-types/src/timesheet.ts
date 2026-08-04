import { z } from 'zod';

/**
 * Fase 32a — Timesheet foundation. Mirrors
 * `apps/api/src/timesheet/dto/timesheet.dto.ts` on the FE.
 */

export const timesheetPeriodTypeSchema = z.enum([
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'CUTOFF',
]);
export type TimesheetPeriodType = z.infer<typeof timesheetPeriodTypeSchema>;

export const weekStartDaySchema = z.enum(['SUNDAY', 'MONDAY']);
export type WeekStartDay = z.infer<typeof weekStartDaySchema>;

export const timesheetEntryKindSchema = z.enum([
  'WORKING',
  'HOLIDAY',
  'WEEKEND',
  'LEAVE',
  'ABSENT',
]);
export type TimesheetEntryKind = z.infer<typeof timesheetEntryKindSchema>;

export const timesheetConfigBounds = {
  cutoffDayOfMonth: { min: 1, max: 28 },
  submitReminderStartDays: { min: 0, max: 30 },
  submitReminderMaxDays: { min: 1, max: 60 },
  approvalReminderStartDays: { min: 0, max: 30 },
  approvalReminderMaxDays: { min: 1, max: 60 },
} as const;

export const timesheetConfigSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  periodType: timesheetPeriodTypeSchema,
  weekStartDay: weekStartDaySchema,
  biweeklyAnchor: z.string().nullable(),
  cutoffDayOfMonth: z.number().int().nullable(),
  timezone: z.string(),
  autoGenerateEnabled: z.boolean(),
  reminderEnabled: z.boolean(),
  submitReminderStartDays: z.number().int(),
  submitReminderMaxDays: z.number().int(),
  approvalReminderStartDays: z.number().int(),
  approvalReminderMaxDays: z.number().int(),
  updatedAt: z.string(),
  updatedById: z.string().nullable(),
});
export type TimesheetConfigDto = z.infer<typeof timesheetConfigSchema>;

export const updateTimesheetConfigInputSchema = z.object({
  periodType: timesheetPeriodTypeSchema.optional(),
  weekStartDay: weekStartDaySchema.optional(),
  biweeklyAnchor: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'biweeklyAnchor must match YYYY-MM-DD')
    .nullable()
    .optional(),
  cutoffDayOfMonth: z
    .number()
    .int()
    .min(timesheetConfigBounds.cutoffDayOfMonth.min)
    .max(timesheetConfigBounds.cutoffDayOfMonth.max)
    .nullable()
    .optional(),
  timezone: z.string().optional(),
  autoGenerateEnabled: z.boolean().optional(),
  reminderEnabled: z.boolean().optional(),
  submitReminderStartDays: z
    .number()
    .int()
    .min(timesheetConfigBounds.submitReminderStartDays.min)
    .max(timesheetConfigBounds.submitReminderStartDays.max)
    .optional(),
  submitReminderMaxDays: z
    .number()
    .int()
    .min(timesheetConfigBounds.submitReminderMaxDays.min)
    .max(timesheetConfigBounds.submitReminderMaxDays.max)
    .optional(),
  approvalReminderStartDays: z
    .number()
    .int()
    .min(timesheetConfigBounds.approvalReminderStartDays.min)
    .max(timesheetConfigBounds.approvalReminderStartDays.max)
    .optional(),
  approvalReminderMaxDays: z
    .number()
    .int()
    .min(timesheetConfigBounds.approvalReminderMaxDays.min)
    .max(timesheetConfigBounds.approvalReminderMaxDays.max)
    .optional(),
});
export type UpdateTimesheetConfigInput = z.infer<
  typeof updateTimesheetConfigInputSchema
>;

export const timesheetUserSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  email: z.string(),
  departmentName: z.string().nullable(),
});
export type TimesheetUser = z.infer<typeof timesheetUserSchema>;

export const timesheetTotalsSchema = z.object({
  regularHours: z.number(),
  overtimeHours: z.number(),
  leaveDays: z.number().int(),
  absentDays: z.number().int(),
  holidays: z.number().int(),
  workingDays: z.number().int(),
  lateMinutes: z.number().int(),
  earlyLeaveMinutes: z.number().int(),
});
export type TimesheetTotals = z.infer<typeof timesheetTotalsSchema>;

export const timesheetEntrySchema = z.object({
  workDate: z.string(),
  kind: timesheetEntryKindSchema,
  expectedHours: z.number().nullable(),
  regularHours: z.number(),
  overtimeHours: z.number(),
  leaveHours: z.number(),
  lateMinutes: z.number().int(),
  earlyLeaveMinutes: z.number().int(),
  note: z.string().nullable(),
});
export type TimesheetEntryRow = z.infer<typeof timesheetEntrySchema>;

export const timesheetStatusSchema = z.enum([
  'DRAFT',
  'PENDING_SUPERVISOR',
  'PENDING_HR',
  'APPROVED',
  'REJECTED',
]);
export type TimesheetStatus = z.infer<typeof timesheetStatusSchema>;

export const timesheetSummarySchema = z.object({
  id: z.string(),
  periodId: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  periodLabel: z.string(),
  user: timesheetUserSchema,
  totals: timesheetTotalsSchema,
  generatedAt: z.string(),
  status: timesheetStatusSchema,
  submittedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  reopenCount: z.number().int(),
  lastReopenedAt: z.string().nullable(),
  lastReopenReason: z.string().nullable(),
});
export type TimesheetSummaryDto = z.infer<typeof timesheetSummarySchema>;

export const timesheetViewSchema = timesheetSummarySchema.extend({
  entries: z.array(timesheetEntrySchema),
  supervisorNote: z.string().nullable(),
  hrManagerNote: z.string().nullable(),
});
export type TimesheetViewDto = z.infer<typeof timesheetViewSchema>;

export const timesheetListSchema = z.object({
  items: z.array(timesheetSummarySchema),
  total: z.number().int(),
});
export type TimesheetListDto = z.infer<typeof timesheetListSchema>;

export const timesheetPeriodSchema = z.object({
  id: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  label: z.string(),
});
export type TimesheetPeriod = z.infer<typeof timesheetPeriodSchema>;

export const timesheetPeriodListSchema = z.object({
  items: z.array(timesheetPeriodSchema),
});
export type TimesheetPeriodListDto = z.infer<typeof timesheetPeriodListSchema>;

export const generateTimesheetInputSchema = z.object({
  at: z.string().datetime().optional(),
});
export type GenerateTimesheetInput = z.infer<
  typeof generateTimesheetInputSchema
>;

export const generateTimesheetResponseSchema = z.object({
  periodId: z.string(),
  timesheetsGenerated: z.number().int(),
  timesheetsSkippedApproved: z.number().int(),
});
export type GenerateTimesheetResponse = z.infer<
  typeof generateTimesheetResponseSchema
>;

// ---------- Workflow (Fase 32b) ----------

export const timesheetDecideActionSchema = z.enum([
  'SUPERVISOR_APPROVE',
  'SUPERVISOR_REJECT',
  'HR_APPROVE',
  'HR_REJECT',
]);
export type TimesheetDecideAction = z.infer<
  typeof timesheetDecideActionSchema
>;

export const decideTimesheetInputSchema = z
  .object({
    action: timesheetDecideActionSchema,
    note: z.string().max(500).optional(),
  })
  .refine(
    (v) => {
      if (v.action === 'SUPERVISOR_REJECT' || v.action === 'HR_REJECT') {
        return typeof v.note === 'string' && v.note.trim().length > 0;
      }
      return true;
    },
    {
      message: 'note is required when rejecting a timesheet',
      path: ['note'],
    },
  );
export type DecideTimesheetInput = z.infer<
  typeof decideTimesheetInputSchema
>;

// ---------- Reopen (Fase 32g) ----------

export const REOPEN_REASON_MIN = 10;
export const REOPEN_REASON_MAX = 500;

export const reopenTimesheetInputSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(REOPEN_REASON_MIN, `Alasan minimal ${REOPEN_REASON_MIN} karakter.`)
    .max(REOPEN_REASON_MAX, `Alasan maksimal ${REOPEN_REASON_MAX} karakter.`),
});
export type ReopenTimesheetInput = z.infer<typeof reopenTimesheetInputSchema>;

export const reopenTimesheetResponseSchema = z.object({
  id: z.string(),
  status: timesheetStatusSchema,
  reopenCount: z.number().int(),
});
export type ReopenTimesheetResponse = z.infer<
  typeof reopenTimesheetResponseSchema
>;

// ---------- Export (Fase 32c) ----------

export const timesheetExportFormatSchema = z.enum(['CSV', 'XLSX']);
export type TimesheetExportFormat = z.infer<typeof timesheetExportFormatSchema>;

export const timesheetExportModeSchema = z.enum(['SUMMARY', 'DETAIL']);
export type TimesheetExportMode = z.infer<typeof timesheetExportModeSchema>;

export const exportTimesheetInputSchema = z.object({
  periodId: z.string().min(1),
  format: timesheetExportFormatSchema,
  mode: timesheetExportModeSchema,
  departmentId: z.string().nullable().optional(),
  note: z.string().max(200).nullable().optional(),
});
export type ExportTimesheetInput = z.infer<typeof exportTimesheetInputSchema>;

export const timesheetExportRowSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  format: timesheetExportFormatSchema,
  mode: timesheetExportModeSchema,
  rowCount: z.number().int(),
  entryCount: z.number().int(),
  bytes: z.number().int(),
  payloadSha256: z.string(),
  note: z.string().nullable(),
  period: z.object({
    id: z.string(),
    label: z.string(),
    periodStart: z.string(),
    periodEnd: z.string(),
  }),
  departmentName: z.string().nullable(),
  requestedBy: z.object({
    id: z.string(),
    fullName: z.string(),
    email: z.string(),
  }),
});
export type TimesheetExportRow = z.infer<typeof timesheetExportRowSchema>;

export const timesheetExportListSchema = z.object({
  items: z.array(timesheetExportRowSchema),
});
export type TimesheetExportListDto = z.infer<typeof timesheetExportListSchema>;

// ---------- Share (Fase 32d) ----------

export const createExportShareInputSchema = z.object({
  ttlHours: z.number().int().min(1).max(168).optional(),
  note: z.string().max(200).nullable().optional(),
});
export type CreateExportShareInput = z.infer<typeof createExportShareInputSchema>;

export const exportShareUrlSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  expiresAt: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type ExportShareUrl = z.infer<typeof exportShareUrlSchema>;

const userMiniSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  email: z.string(),
});

export const exportShareRowSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  downloadCount: z.number().int(),
  lastDownloadedAt: z.string().nullable(),
  note: z.string().nullable(),
  createdBy: userMiniSchema,
  revokedBy: userMiniSchema.nullable(),
  active: z.boolean(),
});
export type ExportShareRow = z.infer<typeof exportShareRowSchema>;

export const exportShareListSchema = z.object({
  items: z.array(exportShareRowSchema),
});
export type ExportShareListDto = z.infer<typeof exportShareListSchema>;
