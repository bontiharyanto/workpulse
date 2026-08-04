import { z } from 'zod';

/**
 * Fase 33a — Analytics wire schemas.
 *
 * Mirrors `apps/api/src/analytics/dto/analytics.dto.ts` plus the shape
 * returned by `AnalyticsQueryService`. The FE parses every API response
 * through these schemas so a drift between BE + FE fails at parse time
 * (network layer), not deep inside a KPI tile render.
 */

export const analyticsMetricKeySchema = z.enum([
  'ATTENDANCE_ON_TIME_RATE',
  'ATTENDANCE_LATE_COUNT',
  'ATTENDANCE_ABSENT_COUNT',
  'LEAVE_PENDING_COUNT',
  'LEAVE_DAYS_APPROVED',
  'OVERTIME_HOURS',
  'OVERTIME_COST_IDR',
  'HEADCOUNT_ACTIVE',
  'HEADCOUNT_TERMINATED',
]);
export type AnalyticsMetricKey = z.infer<typeof analyticsMetricKeySchema>;

export const metricFormatKindSchema = z.enum(['RATIO_PCT', 'COUNT', 'HOURS', 'CURRENCY_IDR']);
export type MetricFormatKind = z.infer<typeof metricFormatKindSchema>;

export const metricDirectionSchema = z.enum(['HIGHER_IS_BETTER', 'LOWER_IS_BETTER', 'NEUTRAL']);
export type MetricDirection = z.infer<typeof metricDirectionSchema>;

export const metricTrendSchema = z.enum(['UP_GOOD', 'UP_BAD', 'DOWN_GOOD', 'DOWN_BAD', 'FLAT']);
export type MetricTrend = z.infer<typeof metricTrendSchema>;

/** Supported look-back windows. Keep in sync with the API's ParseEnum. */
export const ANALYTICS_WINDOW_OPTIONS = [7, 30, 90, 365] as const;
export type AnalyticsWindowDays = (typeof ANALYTICS_WINDOW_OPTIONS)[number];
export const analyticsWindowDaysSchema = z.union([
  z.literal(7),
  z.literal(30),
  z.literal(90),
  z.literal(365),
]);

const windowSchema = z.object({
  from: z.string(),
  to: z.string(),
  today: z.string(),
  days: z.number().int().positive(),
  timezone: z.string(),
});

export const deltaSchema = z.object({
  absolute: z.number(),
  pct: z.number().nullable(),
  trend: metricTrendSchema,
});
export type MetricDelta = z.infer<typeof deltaSchema>;

export const dashboardTileSchema = z.object({
  metricKey: analyticsMetricKeySchema,
  label: z.string(),
  description: z.string(),
  formatKind: metricFormatKindSchema,
  direction: metricDirectionSchema,
  fractionDigits: z.number().int().min(0).max(6),
  currentValue: z.number(),
  previousValue: z.number(),
  delta: deltaSchema,
});
export type DashboardTile = z.infer<typeof dashboardTileSchema>;

export const dashboardResponseSchema = z.object({
  window: windowSchema,
  tiles: z.array(dashboardTileSchema),
  lastComputedAt: z.string().nullable(),
});
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;

export const timeseriesPointSchema = z.object({
  date: z.string(),
  value: z.number(),
  isToday: z.boolean(),
});
export type TimeseriesPoint = z.infer<typeof timeseriesPointSchema>;

export const timeseriesResponseSchema = z.object({
  metricKey: analyticsMetricKeySchema,
  label: z.string(),
  formatKind: metricFormatKindSchema,
  fractionDigits: z.number().int().min(0).max(6),
  window: windowSchema,
  points: z.array(timeseriesPointSchema),
});
export type TimeseriesResponse = z.infer<typeof timeseriesResponseSchema>;
