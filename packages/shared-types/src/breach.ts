import { z } from 'zod';

import { isoDateTimeSchema } from './common.js';

/**
 * Fase 31g — Breach Notification Ledger wire schemas.
 * Mirrors `apps/api/src/breach/**`.
 */

export const breachSeveritySchema = z.enum([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);
export type BreachSeverity = z.infer<typeof breachSeveritySchema>;

export const breachCategorySchema = z.enum([
  'CONFIDENTIALITY',
  'INTEGRITY',
  'AVAILABILITY',
  'MIXED',
]);
export type BreachCategory = z.infer<typeof breachCategorySchema>;

export const breachStatusSchema = z.enum([
  'DETECTED',
  'CONTAINED',
  'NOTIFIED_AUTHORITY',
  'NOTIFIED_SUBJECTS',
  'CLOSED',
]);
export type BreachStatus = z.infer<typeof breachStatusSchema>;

export const breachTimelineEventTypeSchema = z.enum([
  'CREATED',
  'UPDATED',
  'STATUS_ADVANCED',
  'AUTHORITY_NOTIFIED',
  'SUBJECTS_NOTIFIED',
  'NOTE_ADDED',
  'DEADLINE_WARNED',
  'EXPORTED',
  'CLOSED',
]);
export type BreachTimelineEventType = z.infer<
  typeof breachTimelineEventTypeSchema
>;

export const breachDeadlineBucketSchema = z.enum([
  'SAFE',
  'WARNING',
  'CRITICAL',
  'OVERDUE',
]);
export type BreachDeadlineBucket = z.infer<typeof breachDeadlineBucketSchema>;

export const breachDeadlineSchema = z.object({
  deadlineAt: isoDateTimeSchema,
  hoursRemaining: z.number(),
  bucket: breachDeadlineBucketSchema,
  overdue: z.boolean(),
  active: z.boolean(),
});
export type BreachDeadline = z.infer<typeof breachDeadlineSchema>;

// -------- Requests -------------------------------------------------

export const createBreachIncidentInputSchema = z.object({
  title: z.string().trim().min(4).max(200),
  description: z.string().trim().min(20).max(5000),
  severity: breachSeveritySchema,
  category: breachCategorySchema,
  detectedAt: isoDateTimeSchema,
  occurredAt: isoDateTimeSchema.optional(),
  affectedUserCount: z.number().int().min(0).optional(),
  affectedDataCategories: z.array(z.string()).max(30).optional(),
  affectedSystems: z.array(z.string()).max(30).optional(),
  containmentActions: z.string().max(5000).optional(),
  assignedToId: z.string().optional(),
});
export type CreateBreachIncidentInput = z.infer<
  typeof createBreachIncidentInputSchema
>;

export const updateBreachIncidentInputSchema =
  createBreachIncidentInputSchema.partial().extend({
    rootCause: z.string().max(5000).optional(),
    remediation: z.string().max(5000).optional(),
  });
export type UpdateBreachIncidentInput = z.infer<
  typeof updateBreachIncidentInputSchema
>;

export const notifyAuthorityInputSchema = z.object({
  notifiedAt: isoDateTimeSchema,
  authorityRef: z.string().trim().min(1).max(200),
  note: z.string().max(2000).optional(),
});
export type NotifyAuthorityInput = z.infer<typeof notifyAuthorityInputSchema>;

export const notifySubjectsInputSchema = z.object({
  notifiedAt: isoDateTimeSchema,
  template: z.string().trim().min(20).max(5000),
  note: z.string().max(2000).optional(),
});
export type NotifySubjectsInput = z.infer<typeof notifySubjectsInputSchema>;

export const closeBreachInputSchema = z.object({
  postMortemSummary: z.string().trim().min(20).max(5000),
});
export type CloseBreachInput = z.infer<typeof closeBreachInputSchema>;

export const appendBreachNoteInputSchema = z.object({
  note: z.string().trim().min(4).max(4000),
});
export type AppendBreachNoteInput = z.infer<
  typeof appendBreachNoteInputSchema
>;

// -------- Responses ------------------------------------------------

export const breachTimelineEventResponseSchema = z.object({
  id: z.string(),
  eventType: breachTimelineEventTypeSchema,
  note: z.string(),
  metadata: z.record(z.unknown()).nullable(),
  actorId: z.string().nullable(),
  actorEmail: z.string().nullable(),
  occurredAt: isoDateTimeSchema,
});
export type BreachTimelineEventResponse = z.infer<
  typeof breachTimelineEventResponseSchema
>;

export const breachIncidentResponseSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  title: z.string(),
  description: z.string(),
  severity: breachSeveritySchema,
  category: breachCategorySchema,
  status: breachStatusSchema,
  detectedAt: isoDateTimeSchema,
  occurredAt: isoDateTimeSchema.nullable(),
  containedAt: isoDateTimeSchema.nullable(),
  authorityNotifiedAt: isoDateTimeSchema.nullable(),
  subjectsNotifiedAt: isoDateTimeSchema.nullable(),
  closedAt: isoDateTimeSchema.nullable(),
  affectedUserCount: z.number().int(),
  affectedDataCategories: z.array(z.string()),
  affectedSystems: z.array(z.string()),
  containmentActions: z.string(),
  rootCause: z.string().nullable(),
  remediation: z.string().nullable(),
  authorityNotificationRef: z.string().nullable(),
  subjectNotificationTemplate: z.string().nullable(),
  reportedById: z.string(),
  reportedByEmail: z.string().nullable(),
  assignedToId: z.string().nullable(),
  assignedToEmail: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deadline: breachDeadlineSchema,
  timeline: z.array(breachTimelineEventResponseSchema),
});
export type BreachIncidentResponse = z.infer<
  typeof breachIncidentResponseSchema
>;

export const breachIncidentListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  severity: breachSeveritySchema,
  category: breachCategorySchema,
  status: breachStatusSchema,
  detectedAt: isoDateTimeSchema,
  authorityNotifiedAt: isoDateTimeSchema.nullable(),
  affectedUserCount: z.number().int(),
  deadline: breachDeadlineSchema,
  reportedByEmail: z.string().nullable(),
  assignedToEmail: z.string().nullable(),
  updatedAt: isoDateTimeSchema,
});
export type BreachIncidentListItem = z.infer<
  typeof breachIncidentListItemSchema
>;
