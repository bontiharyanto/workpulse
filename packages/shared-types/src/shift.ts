import { z } from 'zod';

import { isoDateTimeSchema } from './common.js';
import { calendarDateSchema } from './leave.js';

export const shiftTypeSchema = z.enum(['STATIC', 'FLEXIBLE', 'ROTATING']);
export type ShiftType = z.infer<typeof shiftTypeSchema>;

/** "HH:mm" — 00:00–23:59. Cross-midnight is expressed by endTime < startTime. */
export const hhMmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/u, 'Format waktu harus HH:mm (00:00 – 23:59)');

export const shiftSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  name: z.string(),
  type: shiftTypeSchema,
  startTime: hhMmSchema,
  endTime: hhMmSchema,
  graceMinutes: z.number().int().min(0).max(240),
  geofenceId: z.string().nullable(),
  geofenceName: z.string().nullable(),
  activeAssignments: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Shift = z.infer<typeof shiftSchema>;

export const createShiftSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: shiftTypeSchema.default('STATIC'),
  startTime: hhMmSchema,
  endTime: hhMmSchema,
  graceMinutes: z.number().int().min(0).max(240).default(0),
  geofenceId: z.string().min(1).nullish(),
});
export type CreateShiftInput = z.infer<typeof createShiftSchema>;

export const updateShiftSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    type: shiftTypeSchema.optional(),
    startTime: hhMmSchema.optional(),
    endTime: hhMmSchema.optional(),
    graceMinutes: z.number().int().min(0).max(240).optional(),
    geofenceId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Setidaknya satu field harus diubah',
  });
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;

// ---- User-Shift assignments ------------------------------------------------

export const shiftAssignmentSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userFullName: z.string(),
  shiftId: z.string(),
  shiftName: z.string(),
  effectiveFrom: calendarDateSchema,
  effectiveTo: calendarDateSchema.nullable(),
  active: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ShiftAssignment = z.infer<typeof shiftAssignmentSchema>;

export const createShiftAssignmentSchema = z
  .object({
    userId: z.string().min(1),
    effectiveFrom: calendarDateSchema,
    effectiveTo: calendarDateSchema.nullish(),
  })
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, {
    message: 'effectiveTo tidak boleh sebelum effectiveFrom',
    path: ['effectiveTo'],
  });
export type CreateShiftAssignmentInput = z.infer<typeof createShiftAssignmentSchema>;

export const endShiftAssignmentSchema = z.object({
  effectiveTo: calendarDateSchema,
});
export type EndShiftAssignmentInput = z.infer<typeof endShiftAssignmentSchema>;
