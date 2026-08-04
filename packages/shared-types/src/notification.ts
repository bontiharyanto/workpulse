import { z } from 'zod';

import { isoDateTimeSchema } from './common.js';

export const notificationTypeSchema = z.enum([
  'LEAVE_SUBMITTED',
  'LEAVE_APPROVED_SUPERVISOR',
  'LEAVE_APPROVED_HR',
  'LEAVE_REJECTED',
  'LEAVE_CANCELLED',
  'OVERTIME_SUBMITTED',
  'OVERTIME_APPROVED',
  'OVERTIME_REJECTED',
  'OVERTIME_CANCELLED',
  'OVERTIME_COMPLETED',
  'PASSWORD_RESET',
  'ATTENDANCE_ABSENT_MARKED',
  'ATTENDANCE_CORRECTION_SUBMITTED',
  'ATTENDANCE_CORRECTION_APPROVED',
  'ATTENDANCE_CORRECTION_REJECTED',
  'DATA_ERASURE_REQUESTED',
  'DATA_ERASURE_APPROVED',
  'DATA_ERASURE_REJECTED',
  'DATA_ERASURE_EXECUTED',
  'TIMESHEET_SUBMITTED',
  'TIMESHEET_APPROVED_SUPERVISOR',
  'TIMESHEET_APPROVED_HR',
  'TIMESHEET_REJECTED',
  'TIMESHEET_REGENERATED',
  'TIMESHEET_SUBMIT_REMINDER',
  'TIMESHEET_APPROVAL_REMINDER',
  'TIMESHEET_REOPENED',
  'BREACH_DEADLINE_WARNING',
  'RETENTION_AUDIT_GAP_DETECTED',
  'VENDOR_REVIEW_DUE',
  'VENDOR_CONTRACT_EXPIRING',
]);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

/**
 * A single row from the recipient's perspective. `data` is intentionally
 * typed loose (`Record<string, unknown>`) — different notification types
 * carry different shapes, and locking that down here would force a giant
 * discriminated-union sync every time we add an event. The frontend
 * discriminates by `type` and reads only the keys it knows about.
 */
export const notificationSchema = z.object({
  id: z.string(),
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  data: z.record(z.unknown()).nullable().optional(),
  readAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const unreadCountResponseSchema = z.object({
  unreadCount: z.number().int().nonnegative(),
});
export type UnreadCountResponse = z.infer<typeof unreadCountResponseSchema>;

// ---------------------------------------------------------------------------
// Archive view (Fase 25) — paginated over `(createdAt, id)` for the
// `/notifications` page. The bell dropdown still uses the flat
// `notificationSchema[]` variant because it never paginates.
// ---------------------------------------------------------------------------

export const notificationPageSchema = z.object({
  rows: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
});
export type NotificationPage = z.infer<typeof notificationPageSchema>;

export const notificationArchiveQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});
export type NotificationArchiveQuery = z.infer<typeof notificationArchiveQuerySchema>;

// ---------------------------------------------------------------------------
// Preferences (Fase 22)
// ---------------------------------------------------------------------------

/**
 * One row per known type in `GET /notifications/preferences`. `mandatory`
 * = true means the toggles are effectively locked on — the FE should
 * render them as read-only.
 */
export const notificationPreferenceRowSchema = z.object({
  type: notificationTypeSchema,
  emailEnabled: z.boolean(),
  inAppEnabled: z.boolean(),
  mandatory: z.boolean(),
});
export type NotificationPreferenceRow = z.infer<typeof notificationPreferenceRowSchema>;

export const notificationPreferenceUpdateItemSchema = z.object({
  type: notificationTypeSchema,
  emailEnabled: z.boolean(),
  inAppEnabled: z.boolean(),
});
export type NotificationPreferenceUpdateItem = z.infer<
  typeof notificationPreferenceUpdateItemSchema
>;

export const updateNotificationPreferencesInputSchema = z.object({
  updates: z.array(notificationPreferenceUpdateItemSchema).max(32),
});
export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesInputSchema
>;
