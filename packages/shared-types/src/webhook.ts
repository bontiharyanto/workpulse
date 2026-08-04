import { z } from 'zod';

/**
 * Fase 32e — outbound webhook shapes shared between API + web.
 */

export const webhookEventTypeSchema = z.enum([
  'TIMESHEET_EXPORT_CREATED',
  'TIMESHEET_EXPORT_SHARE_CREATED',
  'TIMESHEET_REOPENED',
]);
export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>;

export const webhookDeliveryStatusSchema = z.enum(['PENDING', 'SUCCEEDED', 'FAILED']);
export type WebhookDeliveryStatus = z.infer<typeof webhookDeliveryStatusSchema>;

// ---------- Admin CRUD ----------

export const createWebhookInputSchema = z.object({
  url: z.string().url().max(1024),
  description: z.string().max(200).nullable().optional(),
  events: z.array(webhookEventTypeSchema).min(1),
});
export type CreateWebhookInput = z.infer<typeof createWebhookInputSchema>;

export const updateWebhookInputSchema = z.object({
  url: z.string().url().max(1024).optional(),
  description: z.string().max(200).nullable().optional(),
  events: z.array(webhookEventTypeSchema).min(1).optional(),
  active: z.boolean().optional(),
});
export type UpdateWebhookInput = z.infer<typeof updateWebhookInputSchema>;

const userMiniSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  email: z.string(),
});

export const webhookEndpointRowSchema = z.object({
  id: z.string(),
  url: z.string(),
  description: z.string().nullable(),
  events: z.array(webhookEventTypeSchema),
  active: z.boolean(),
  consecutiveFailures: z.number().int(),
  lastSuccessAt: z.string().nullable(),
  lastFailureAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: userMiniSchema,
});
export type WebhookEndpointRow = z.infer<typeof webhookEndpointRowSchema>;

export const webhookEndpointWithSecretSchema = webhookEndpointRowSchema.extend({
  secret: z.string(),
});
export type WebhookEndpointWithSecret = z.infer<typeof webhookEndpointWithSecretSchema>;

export const webhookEndpointListSchema = z.object({
  items: z.array(webhookEndpointRowSchema),
});
export type WebhookEndpointListDto = z.infer<typeof webhookEndpointListSchema>;

// ---------- Delivery log ----------

export const webhookDeliveryRowSchema = z.object({
  id: z.string(),
  endpointId: z.string(),
  eventType: webhookEventTypeSchema,
  sourceId: z.string(),
  status: webhookDeliveryStatusSchema,
  attemptCount: z.number().int(),
  nextAttemptAt: z.string(),
  lastAttemptAt: z.string().nullable(),
  lastResponseStatus: z.number().int().nullable(),
  lastError: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  createdAt: z.string(),
});
export type WebhookDeliveryRow = z.infer<typeof webhookDeliveryRowSchema>;

export const webhookDeliveryListSchema = z.object({
  items: z.array(webhookDeliveryRowSchema),
});
export type WebhookDeliveryListDto = z.infer<typeof webhookDeliveryListSchema>;

// ---------- Outbound envelope (what vendors receive) ----------

export const webhookEnvelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
  occurredAt: z.string(),
  tenant: z.object({ companyId: z.string() }),
  data: z.record(z.unknown()),
});
export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;
