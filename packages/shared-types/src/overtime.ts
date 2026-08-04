import { z } from 'zod';

import { isoDateTimeSchema } from './common.js';
import { calendarDateSchema } from './leave.js';

export const overtimeStatusSchema = z.enum([
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'COMPLETED',
  'CANCELLED',
]);
export type OvertimeStatus = z.infer<typeof overtimeStatusSchema>;

export const overtimeDayKindSchema = z.enum(['WEEKDAY', 'WEEKEND', 'HOLIDAY']);
export type OvertimeDayKind = z.infer<typeof overtimeDayKindSchema>;

/**
 * Hours must be > 0, ≤ 12 (hard cap; company may enforce lower via
 * `overtimeMaxHoursPerDay`), and have at most 2 decimals.
 */
export const overtimeHoursSchema = z
  .number()
  .positive('Jam lembur harus lebih dari 0')
  .max(12, 'Jam lembur maksimum 12 per hari')
  .refine((n) => Math.round(n * 100) === n * 100, {
    message: 'Jam lembur maksimum 2 angka di belakang koma',
  });

export const overtimeRequestInputSchema = z.object({
  workDate: calendarDateSchema,
  hours: overtimeHoursSchema,
  reason: z.string().trim().min(3, 'Alasan minimal 3 karakter').max(1000),
});
export type OvertimeRequestInput = z.infer<typeof overtimeRequestInputSchema>;

export const overtimeDecisionInputSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(1000).optional(),
});
export type OvertimeDecisionInput = z.infer<typeof overtimeDecisionInputSchema>;

export const overtimeRequestSchema = z.object({
  id: z.string(),
  userId: z.string(),
  /** Full name of requester — populated when the caller has approver visibility. */
  userFullName: z.string().optional(),
  workDate: calendarDateSchema,
  hours: z.number().positive(),
  reason: z.string(),
  status: overtimeStatusSchema,
  dayKind: overtimeDayKindSchema,
  baseRate: z.number().nonnegative(),
  rateMultiplier: z.number().positive(),
  ratePerHour: z.number().nonnegative(),
  totalAmount: z.number().nonnegative(),
  approvedById: z.string().nullable(),
  approvedAt: isoDateTimeSchema.nullable(),
  rejectedAt: isoDateTimeSchema.nullable(),
  decisionNote: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type OvertimeRequest = z.infer<typeof overtimeRequestSchema>;
