import { z } from 'zod';

import { isoDateTimeSchema } from './common.js';

/** Persistent department representation returned by the API. */
export const departmentSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  parentName: z.string().nullable(),
  userCount: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Department = z.infer<typeof departmentSchema>;

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(2, { message: 'Nama minimal 2 karakter' }).max(120),
  parentId: z.string().min(1).nullish(),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  parentId: z.string().min(1).nullable().optional(),
});
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
