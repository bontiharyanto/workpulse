import { z } from 'zod';

import { isoDateTimeSchema } from './common.js';

export const leaveStatusSchema = z.enum([
  'DRAFT',
  'PENDING_SUPERVISOR',
  'PENDING_HR',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
]);
export type LeaveStatus = z.infer<typeof leaveStatusSchema>;

export const leaveKindSchema = z.enum([
  'ANNUAL',
  'SICK',
  'PERSONAL',
  'MATERNITY',
  'PATERNITY',
  'UNPAID',
  'OTHER',
]);
export type LeaveKind = z.infer<typeof leaveKindSchema>;

/** A YYYY-MM-DD calendar date (interpreted as the company local calendar day). */
export const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');

export const leaveRequestInputSchema = z
  .object({
    leaveTypeId: z.string().min(1),
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
    reason: z.string().min(3, 'Alasan minimal 3 karakter').max(1000),
    /**
     * Server-issued S3 object key received from `POST /attachments/presign` and
     * uploaded via presigned PUT. NOT a user-supplied URL — the server rejects
     * any key that does not match the requesting user's ownership prefix.
     */
    attachmentKey: z.string().min(1).optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'Tanggal akhir tidak boleh sebelum tanggal mulai',
    path: ['endDate'],
  });
export type LeaveRequestInput = z.infer<typeof leaveRequestInputSchema>;

export const leaveApprovalInputSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  note: z.string().max(1000).optional(),
});
export type LeaveApprovalInput = z.infer<typeof leaveApprovalInputSchema>;

export const leaveRequestSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userFullName: z.string().optional(),
  leaveTypeId: z.string(),
  leaveTypeName: z.string(),
  leaveTypeKind: leaveKindSchema,
  status: leaveStatusSchema,
  startDate: calendarDateSchema,
  endDate: calendarDateSchema,
  days: z.number().int().positive(),
  reason: z.string(),
  /**
   * Short-lived presigned GET URL when the request has an attachment, else null.
   * Regenerated on every read — do NOT cache this on the client for long.
   */
  attachmentUrl: z.string().url().nullable(),
  supervisorId: z.string().nullable(),
  hrManagerId: z.string().nullable(),
  supervisorAt: isoDateTimeSchema.nullable(),
  hrManagerAt: isoDateTimeSchema.nullable(),
  supervisorNote: z.string().nullable(),
  hrManagerNote: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type LeaveRequest = z.infer<typeof leaveRequestSchema>;

export const leaveBalanceSchema = z.object({
  leaveTypeId: z.string(),
  leaveTypeCode: z.string(),
  leaveTypeName: z.string(),
  kind: leaveKindSchema,
  year: z.number().int(),
  quota: z.number().int(),
  carriedOver: z.number().int(),
  used: z.number().int(),
  reserved: z.number().int(),
  remaining: z.number().int(),
});
export type LeaveBalance = z.infer<typeof leaveBalanceSchema>;
