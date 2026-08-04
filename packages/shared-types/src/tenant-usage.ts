import { z } from 'zod';

/**
 * OPS-7 — Tenant usage snapshot shared types. Mirrors
 * `apps/api/src/tenant-usage/dto/tenant-usage.dto.ts`.
 *
 * BigInt storage / db-total values are transported as **stringified
 * integers** (e.g. `"12345678"`) so they survive JSON round-trips
 * without silently losing precision at 2^53. The FE parses them with
 * `BigInt(v)` or `Number(v)` depending on the widget.
 */

export const bigIntStringSchema = z.string().regex(/^\d+$/, {
  message: 'must be a non-negative integer encoded as a string',
});

export const tenantUsageSnapshotSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  generatedAt: z.string(),

  storageExportBytes: bigIntStringSchema,
  storageDsarBytes: bigIntStringSchema,
  storageTotalBytes: bigIntStringSchema,
  attachmentBytesTracked: z.boolean(),

  dbRowsUser: z.number().int(),
  dbRowsAttendance: z.number().int(),
  dbRowsLeave: z.number().int(),
  dbRowsOvertime: z.number().int(),
  dbRowsTimesheetEntry: z.number().int(),
  dbRowsAuditLog: z.number().int(),
  dbRowsNotification: z.number().int(),
  dbRowsTimesheetExport: z.number().int(),
  dbRowsWebhookDelivery: z.number().int(),
  dbRowsTotal: bigIntStringSchema,

  notificationsCreated: z.number().int(),
  webhookDeliveries: z.number().int(),

  activeUsers: z.number().int(),
  totalUsers: z.number().int(),

  notes: z.string().nullable(),
});
export type TenantUsageSnapshotDto = z.infer<typeof tenantUsageSnapshotSchema>;

export const tenantUsageListResponseSchema = z.object({
  rows: z.array(tenantUsageSnapshotSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type TenantUsageListResponseDto = z.infer<typeof tenantUsageListResponseSchema>;

export const regenerateTenantUsageInputSchema = z.object({
  companyId: z.string(),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});
export type RegenerateTenantUsageInput = z.infer<typeof regenerateTenantUsageInputSchema>;
