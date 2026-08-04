import { z } from 'zod';

import { isoDateTimeSchema } from './common.js';
import { calendarDateSchema } from './leave.js';

export const attendanceCorrectionStatusSchema = z.enum([
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
]);
export type AttendanceCorrectionStatus = z.infer<
  typeof attendanceCorrectionStatusSchema
>;

/**
 * Shape validated on the FE before hitting the API. The API also validates
 * with class-validator DTOs (redundant on purpose — the shared schema is
 * for FE-side form validation via react-hook-form + zodResolver).
 *
 * The `at least one of requestedClockInAt / OutAt` invariant is enforced
 * via `.refine()`; the API service layer re-checks it defensively.
 */
export const attendanceCorrectionInputSchema = z
  .object({
    workDate: calendarDateSchema,
    requestedClockInAt: isoDateTimeSchema.nullable().optional(),
    requestedClockOutAt: isoDateTimeSchema.nullable().optional(),
    reason: z
      .string()
      .trim()
      .min(5, 'Alasan minimal 5 karakter')
      .max(500, 'Alasan maksimum 500 karakter'),
    attachmentKey: z.string().max(500).optional(),
  })
  .refine(
    (v) => Boolean(v.requestedClockInAt || v.requestedClockOutAt),
    {
      path: ['requestedClockInAt'],
      message: 'Isi minimal salah satu jam masuk atau jam pulang',
    },
  );
export type AttendanceCorrectionInput = z.infer<
  typeof attendanceCorrectionInputSchema
>;

export const attendanceCorrectionDecisionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(500).optional(),
});
export type AttendanceCorrectionDecision = z.infer<
  typeof attendanceCorrectionDecisionSchema
>;

export const attendanceCorrectionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userFullName: z.string().optional(),
  workDate: calendarDateSchema,
  requestedClockInAt: isoDateTimeSchema.nullable(),
  requestedClockOutAt: isoDateTimeSchema.nullable(),
  reason: z.string(),
  attachmentUrl: z.string().url().nullable(),
  status: attendanceCorrectionStatusSchema,
  supervisorId: z.string().nullable(),
  decidedById: z.string().nullable(),
  decidedAt: isoDateTimeSchema.nullable(),
  decisionNote: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type AttendanceCorrection = z.infer<typeof attendanceCorrectionSchema>;
