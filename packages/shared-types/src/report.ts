import { z } from 'zod';

import { calendarDateSchema } from './leave.js';
import { overtimeStatusSchema } from './overtime.js';

export const reportFormatSchema = z.enum(['xlsx', 'pdf']);
export type ReportFormat = z.infer<typeof reportFormatSchema>;

/**
 * Attendance report filter. `endDate` is inclusive.
 *
 * Max window guarded server-side:
 *   - xlsx: 366 hari
 *   - pdf : 92  hari (PDF paginated rendering is quadratic in row count)
 */
export const attendanceReportRequestSchema = z
  .object({
    format: reportFormatSchema,
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
    departmentId: z.string().min(1).nullish(),
    userIds: z.array(z.string().min(1)).max(500).nullish(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'endDate tidak boleh sebelum startDate',
    path: ['endDate'],
  });
export type AttendanceReportRequest = z.infer<typeof attendanceReportRequestSchema>;

export const leaveSummaryReportRequestSchema = z.object({
  format: reportFormatSchema,
  year: z.number().int().gte(2000).lte(2100),
  departmentId: z.string().min(1).nullish(),
});
export type LeaveSummaryReportRequest = z.infer<typeof leaveSummaryReportRequestSchema>;

/**
 * Overtime summary report filter. `endDate` is inclusive.
 *
 * Max window guarded server-side (same caps as attendance):
 *   - xlsx: 366 hari
 *   - pdf : 92  hari
 *
 * `statuses` defaults to `['APPROVED', 'COMPLETED']` when omitted — this is
 * the payroll view. Set explicitly to include `PENDING_APPROVAL`, `REJECTED`,
 * or `CANCELLED` rows for audit exports.
 */
export const overtimeReportRequestSchema = z
  .object({
    format: reportFormatSchema,
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
    departmentId: z.string().min(1).nullish(),
    userIds: z.array(z.string().min(1)).max(500).nullish(),
    statuses: z.array(overtimeStatusSchema).max(5).nullish(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'endDate tidak boleh sebelum startDate',
    path: ['endDate'],
  });
export type OvertimeReportRequest = z.infer<typeof overtimeReportRequestSchema>;
