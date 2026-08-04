import { z } from 'zod';

import { userRoleSchema } from './auth.js';
import { isoDateTimeSchema } from './common.js';

export const employmentStatusSchema = z.enum(['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED']);
export type EmploymentStatus = z.infer<typeof employmentStatusSchema>;

/** Admin-facing user summary — never carries password fields. */
export const adminUserSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  email: z.string().email(),
  fullName: z.string(),
  role: userRoleSchema,
  employmentStatus: employmentStatusSchema,
  departmentId: z.string().nullable(),
  departmentName: z.string().nullable(),
  supervisorId: z.string().nullable(),
  supervisorName: z.string().nullable(),
  hiredAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deactivatedAt: isoDateTimeSchema.nullable(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email({ message: 'Format email tidak valid' }).max(255),
  fullName: z.string().trim().min(2, 'Nama minimal 2 karakter').max(200),
  role: userRoleSchema,
  departmentId: z.string().min(1).nullish(),
  supervisorId: z.string().min(1).nullish(),
  hiredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Format tanggal harus YYYY-MM-DD'),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(2).max(200).optional(),
    role: userRoleSchema.optional(),
    departmentId: z.string().min(1).nullable().optional(),
    supervisorId: z.string().min(1).nullable().optional(),
    employmentStatus: employmentStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Setidaknya satu field harus diubah',
  });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const listUsersQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  role: userRoleSchema.optional(),
  departmentId: z.string().min(1).optional(),
  status: employmentStatusSchema.optional(),
  includeInactive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (typeof v === 'string' ? v === 'true' : (v ?? false))),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

/** Returned once when a new user is created OR an admin resets a password. */
export const userCredentialResponseSchema = z.object({
  user: adminUserSchema,
  temporaryPassword: z.string(),
});
export type UserCredentialResponse = z.infer<typeof userCredentialResponseSchema>;
