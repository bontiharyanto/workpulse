import { z } from 'zod';

import { isoDateTimeSchema } from './common.js';
import { leaveKindSchema } from './leave.js';

/** Admin-facing leave type with usage stats — richer than `LeaveTypeOption`. */
export const adminLeaveTypeSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  code: z.string(),
  name: z.string(),
  kind: leaveKindSchema,
  defaultAnnualQuota: z.number().int().nonnegative(),
  carryOverMax: z.number().int().nonnegative(),
  requiresAttachment: z.boolean(),
  balanceCount: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type AdminLeaveType = z.infer<typeof adminLeaveTypeSchema>;

export const createLeaveTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,30}$/u, 'Code harus huruf besar/angka/underscore, 2–30 karakter'),
  name: z.string().trim().min(2).max(120),
  kind: leaveKindSchema,
  defaultAnnualQuota: z.number().int().min(0).max(365),
  carryOverMax: z.number().int().min(0).max(365),
  requiresAttachment: z.boolean().default(false),
});
export type CreateLeaveTypeInput = z.infer<typeof createLeaveTypeSchema>;

export const updateLeaveTypeSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    kind: leaveKindSchema.optional(),
    defaultAnnualQuota: z.number().int().min(0).max(365).optional(),
    carryOverMax: z.number().int().min(0).max(365).optional(),
    requiresAttachment: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Setidaknya satu field harus diubah',
  });
export type UpdateLeaveTypeInput = z.infer<typeof updateLeaveTypeSchema>;
