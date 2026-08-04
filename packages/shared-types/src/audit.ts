import { z } from 'zod';

import { isoDateTimeSchema } from './common.js';

/**
 * Audit log viewer types (Fase 23).
 *
 * The row shape mirrors `AuditLog` in the API — `beforeJson` and
 * `afterJson` stay loosely typed (`unknown`) because they hold action
 * specific snapshots. The FE renders them via a generic key-by-key
 * diff view instead of a per-action mapping (see ADR-0013 §D3).
 */

export const auditLogRowSchema = z.object({
  id: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  actorId: z.string(),
  actorName: z.string().nullable(),
  actorEmail: z.string().nullable(),
  beforeJson: z.unknown().nullable().optional(),
  afterJson: z.unknown().nullable().optional(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type AuditLogRow = z.infer<typeof auditLogRowSchema>;

export const auditLogPageSchema = z.object({
  rows: z.array(auditLogRowSchema),
  nextCursor: z.string().nullable(),
});
export type AuditLogPage = z.infer<typeof auditLogPageSchema>;

/**
 * FE-side filter shape. All fields optional; matches the query DTO
 * exactly (server accepts `from`/`to` as ISO strings). We keep `from`/
 * `to` typed as strings here — the FE `api-client` serializes them
 * into the URL and the server parses them into `Date` via
 * `class-transformer`.
 */
export const auditLogFiltersSchema = z.object({
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  actorId: z.string().optional(),
  action: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type AuditLogFilters = z.infer<typeof auditLogFiltersSchema>;
