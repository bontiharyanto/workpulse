import { z } from 'zod';

import { isoDateTimeSchema } from './common.js';

/**
 * Cross-module PENDING approval visibility (`GET /admin/approvals/backlog`).
 *
 * The FE renders a small summary tile + a detailed drill-down page from
 * this response. Bucket names mirror the backend domain
 * (`d0_1` / `d1_3` / `d3_7` / `d7_plus`).
 */

export const backlogBucketCountsSchema = z.object({
  d0_1: z.number().int().nonnegative(),
  d1_3: z.number().int().nonnegative(),
  d3_7: z.number().int().nonnegative(),
  d7_plus: z.number().int().nonnegative(),
});
export type BacklogBucketCounts = z.infer<typeof backlogBucketCountsSchema>;

export const backlogItemSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userFullName: z.string(),
  createdAt: isoDateTimeSchema,
  ageDays: z.number().int().nonnegative(),
  summary: z.string(),
});
export type BacklogItem = z.infer<typeof backlogItemSchema>;

export const moduleBacklogSchema = z.object({
  total: z.number().int().nonnegative(),
  fresh: z.number().int().nonnegative(),
  stale: z.number().int().nonnegative(),
  buckets: backlogBucketCountsSchema,
  oldest: z.array(backlogItemSchema),
});
export type ModuleBacklog = z.infer<typeof moduleBacklogSchema>;

export const backlogSummarySchema = z.object({
  generatedAt: isoDateTimeSchema,
  staleAfterDays: z.number().int().min(1).max(60),
  leave: moduleBacklogSchema,
  overtime: moduleBacklogSchema,
  correction: moduleBacklogSchema,
});
export type BacklogSummary = z.infer<typeof backlogSummarySchema>;
