import { z } from 'zod';

import {
  accuracyMetersSchema,
  isoDateTimeSchema,
  latitudeSchema,
  longitudeSchema,
} from './common.js';

export const clockInInputSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  accuracyMeters: accuracyMetersSchema,
  note: z.string().max(500).optional(),
});
export type ClockInInput = z.infer<typeof clockInInputSchema>;

export const clockOutInputSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  accuracyMeters: accuracyMetersSchema,
  note: z.string().max(500).optional(),
});
export type ClockOutInput = z.infer<typeof clockOutInputSchema>;

export const attendanceStatusSchema = z.enum([
  'ON_TIME',
  'LATE',
  'EARLY_LEAVE',
  'ABSENT',
  'ON_LEAVE',
]);
export type AttendanceStatus = z.infer<typeof attendanceStatusSchema>;

export const attendanceRecordSchema = z.object({
  id: z.string(),
  userId: z.string(),
  shiftId: z.string(),
  workDate: isoDateTimeSchema,
  clockInAt: isoDateTimeSchema,
  clockOutAt: isoDateTimeSchema.nullable(),
  status: attendanceStatusSchema,
  clockInLatitude: z.number(),
  clockInLongitude: z.number(),
  clockOutLatitude: z.number().nullable(),
  clockOutLongitude: z.number().nullable(),
  lateMinutes: z.number().int().nonnegative(),
  earlyLeaveMinutes: z.number().int().nonnegative(),
});
export type AttendanceRecord = z.infer<typeof attendanceRecordSchema>;

// ---------------------------------------------------------------------------
// History / summary — self-service widgets on the dashboard.
// ---------------------------------------------------------------------------

export const isoCalendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const attendanceHistoryQuerySchema = z.object({
  from: isoCalendarDateSchema.optional(),
  to: isoCalendarDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type AttendanceHistoryQuery = z.infer<typeof attendanceHistoryQuerySchema>;

export const attendanceMonthlySummarySchema = z.object({
  year: z.number().int().min(2000).max(3000),
  month: z.number().int().min(1).max(12),
  totalRecords: z.number().int().nonnegative(),
  presentDays: z.number().int().nonnegative(),
  onTimeDays: z.number().int().nonnegative(),
  lateDays: z.number().int().nonnegative(),
  earlyLeaveDays: z.number().int().nonnegative(),
  absentDays: z.number().int().nonnegative(),
  totalLateMinutes: z.number().int().nonnegative(),
  totalEarlyLeaveMinutes: z.number().int().nonnegative(),
  totalHoursWorked: z.number().nonnegative(),
  /** `null` when no clock-ins in the month (dividing by zero). */
  onTimeRatePercent: z.number().min(0).max(100).nullable(),
});
export type AttendanceMonthlySummary = z.infer<typeof attendanceMonthlySummarySchema>;

// ---------------------------------------------------------------------------
// Team views (supervisor / HR)
// ---------------------------------------------------------------------------

export const teamAttendanceStatusSchema = z.enum([
  'ON_TIME',
  'LATE',
  'EARLY_LEAVE',
  'ABSENT',
  'ON_LEAVE',
  /** No AttendanceRecord row exists for this date — distinct from ABSENT which is HR-set. */
  'NOT_CLOCKED_IN',
]);
export type TeamAttendanceStatus = z.infer<typeof teamAttendanceStatusSchema>;

export const absenceSourceSchema = z.enum(['AUTO_SCHEDULER', 'MANUAL_HR']);
export type AbsenceSource = z.infer<typeof absenceSourceSchema>;

export const teamMemberDailyRowSchema = z.object({
  userId: z.string(),
  fullName: z.string(),
  email: z.string(),
  departmentName: z.string().nullable(),
  status: teamAttendanceStatusSchema,
  clockInAt: isoDateTimeSchema.nullable(),
  clockOutAt: isoDateTimeSchema.nullable(),
  lateMinutes: z.number().int().nonnegative(),
  earlyLeaveMinutes: z.number().int().nonnegative(),
  /**
   * Non-null when `status === 'ABSENT'` — the id of the backing
   * `AbsenceRecord`. Consumed by HR UIs to render "Batalkan absen".
   */
  absenceRecordId: z.string().nullable(),
  absenceSource: absenceSourceSchema.nullable(),
});
export type TeamMemberDailyRow = z.infer<typeof teamMemberDailyRowSchema>;

export const teamMemberSummaryRowSchema = z.object({
  userId: z.string(),
  fullName: z.string(),
  email: z.string(),
  departmentName: z.string().nullable(),
  presentDays: z.number().int().nonnegative(),
  onTimeDays: z.number().int().nonnegative(),
  lateDays: z.number().int().nonnegative(),
  earlyLeaveDays: z.number().int().nonnegative(),
  absentDays: z.number().int().nonnegative(),
  totalLateMinutes: z.number().int().nonnegative(),
  totalEarlyLeaveMinutes: z.number().int().nonnegative(),
  totalHoursWorked: z.number().nonnegative(),
  onTimeRatePercent: z.number().min(0).max(100).nullable(),
});
export type TeamMemberSummaryRow = z.infer<typeof teamMemberSummaryRowSchema>;

export const teamSummaryResponseSchema = z.object({
  from: isoCalendarDateSchema,
  to: isoCalendarDateSchema,
  rows: z.array(teamMemberSummaryRowSchema),
});
export type TeamSummaryResponse = z.infer<typeof teamSummaryResponseSchema>;

export const teamRangeQuerySchema = z.object({
  from: isoCalendarDateSchema.optional(),
  to: isoCalendarDateSchema.optional(),
});
export type TeamRangeQuery = z.infer<typeof teamRangeQuerySchema>;

export const teamDailyQuerySchema = z.object({
  date: isoCalendarDateSchema.optional(),
});
export type TeamDailyQuery = z.infer<typeof teamDailyQuerySchema>;

// ---------------------------------------------------------------------------
// Company-wide HR dashboard
// ---------------------------------------------------------------------------

const dashboardTotalsShape = {
  total: z.number().int().nonnegative(),
  clockedIn: z.number().int().nonnegative(),
  absent: z.number().int().nonnegative(),
  onLeave: z.number().int().nonnegative(),
  notClockedIn: z.number().int().nonnegative(),
  lateToday: z.number().int().nonnegative(),
  earlyLeaveToday: z.number().int().nonnegative(),
  onTimeRatePercent: z.number().min(0).max(100).nullable(),
};

export const departmentDashboardSnapshotSchema = z.object({
  departmentId: z.string().nullable(),
  departmentName: z.string().nullable(),
  ...dashboardTotalsShape,
});
export type DepartmentDashboardSnapshot = z.infer<typeof departmentDashboardSnapshotSchema>;

export const companyDashboardSnapshotSchema = z.object({
  date: isoCalendarDateSchema,
  ...dashboardTotalsShape,
  departments: z.array(departmentDashboardSnapshotSchema),
});
export type CompanyDashboardSnapshot = z.infer<typeof companyDashboardSnapshotSchema>;

export const dashboardQuerySchema = z.object({
  date: isoCalendarDateSchema.optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

// ---------------------------------------------------------------------------
// Manual HR override — create / delete AbsenceRecord
// ---------------------------------------------------------------------------

export const createAbsenceInputSchema = z.object({
  userId: z.string().regex(/^[A-Za-z0-9_-]{5,60}$/, 'INVALID_USER_ID'),
  workDate: isoCalendarDateSchema,
  reason: z.string().trim().max(500).optional(),
});
export type CreateAbsenceInput = z.infer<typeof createAbsenceInputSchema>;

/**
 * Response shape for `POST /attendance/absence`. Deliberately narrow —
 * the FE cares about the id (for optimistic delete) + workDate/source
 * (to render a fresh row in the daily view without a refetch).
 */
export const createAbsenceResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  workDate: isoCalendarDateSchema,
  source: absenceSourceSchema,
  reason: z.string().nullable(),
  markedById: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type CreateAbsenceResponse = z.infer<typeof createAbsenceResponseSchema>;

// ---------------------------------------------------------------------------
// Scanner cursor reset (SUPER_ADMIN ops — ADR-0010 follow-up)
// ---------------------------------------------------------------------------

export const resetScannerCursorInputSchema = z.object({
  triggerRescan: z.boolean().optional(),
});
export type ResetScannerCursorInput = z.infer<typeof resetScannerCursorInputSchema>;

/**
 * Skip-reason counts returned by the tenant-scoped rescan. Matches the
 * `AbsenceScanResult.skipped` shape on the API side — only the keys we
 * expose to admin UIs are typed here.
 */
export const scannerRescanSkippedSchema = z.object({
  INACTIVE: z.number().int().nonnegative(),
  NOT_HIRED_YET: z.number().int().nonnegative(),
  WEEKEND: z.number().int().nonnegative(),
  HOLIDAY: z.number().int().nonnegative(),
  NO_SHIFT_ASSIGNMENT: z.number().int().nonnegative(),
  CLOCKED_IN: z.number().int().nonnegative(),
  ON_APPROVED_LEAVE: z.number().int().nonnegative(),
  ALREADY_MARKED: z.number().int().nonnegative(),
  PAYROLL_LOCKED: z.number().int().nonnegative(),
  ERROR: z.number().int().nonnegative(),
});
export type ScannerRescanSkipped = z.infer<typeof scannerRescanSkippedSchema>;

export const scannerRescanResultSchema = z.object({
  companyId: z.string(),
  scannedDates: z.number().int().nonnegative(),
  marked: z.number().int().nonnegative(),
  skipped: scannerRescanSkippedSchema,
  durationMs: z.number().nonnegative(),
});
export type ScannerRescanResult = z.infer<typeof scannerRescanResultSchema>;

export const resetScannerCursorResponseSchema = z.object({
  /** ISO calendar date of the cursor before the reset, or `null` if never set. */
  before: isoCalendarDateSchema.nullable(),
  /** Always `null` — cursor is cleared. */
  after: z.null(),
  rescanTriggered: z.boolean(),
  rescanResult: scannerRescanResultSchema.optional(),
});
export type ResetScannerCursorResponse = z.infer<typeof resetScannerCursorResponseSchema>;
