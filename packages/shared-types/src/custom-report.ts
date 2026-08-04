import { z } from 'zod';

/**
 * Fase 33b — custom report builder wire schemas.
 * Mirrors `apps/api/src/reports/domain/custom-report-definition.ts`.
 */

export const customReportDimensionSchema = z.enum([
  'DAY',
  'DEPARTMENT',
  'USER',
]);
export type CustomReportDimension = z.infer<typeof customReportDimensionSchema>;

export const customReportMetricSchema = z.enum([
  'ATTENDANCE_COUNT',
  'ATTENDANCE_LATE_COUNT',
  'ATTENDANCE_ON_TIME_RATE',
  'LEAVE_DAYS_APPROVED',
  'OVERTIME_HOURS',
]);
export type CustomReportMetric = z.infer<typeof customReportMetricSchema>;

export const CUSTOM_REPORT_WINDOWS_TS = [7, 30, 90, 365] as const;
export type CustomReportWindow = (typeof CUSTOM_REPORT_WINDOWS_TS)[number];

export const customReportDefinitionSchema = z.object({
  dimension: customReportDimensionSchema,
  metric: customReportMetricSchema,
  filter: z.object({
    windowDays: z.union([
      z.literal(7),
      z.literal(30),
      z.literal(90),
      z.literal(365),
    ]),
    departmentId: z.string().optional(),
  }),
});
export type CustomReportDefinition = z.infer<
  typeof customReportDefinitionSchema
>;

export const customReportRowSchema = z.object({
  key: z.string(),
  label: z.string().optional(),
  value: z.number(),
});
export type CustomReportRow = z.infer<typeof customReportRowSchema>;

export const customReportResultSchema = z.object({
  definition: z.unknown(),
  rows: z.array(customReportRowSchema),
  totalRows: z.number().int(),
  computedAt: z.string(),
});
export type CustomReportResult = z.infer<typeof customReportResultSchema>;

export const customReportCatalogueSchema = z.object({
  dimensions: z.array(customReportDimensionSchema),
  metrics: z.array(customReportMetricSchema),
  windows: z.array(z.number().int()),
  metricDescriptors: z.array(
    z.object({
      metric: customReportMetricSchema,
      label: z.string(),
      unit: z.enum(['count', 'rate', 'days', 'hours']),
      fractionDigits: z.number().int(),
    }),
  ),
});
export type CustomReportCatalogue = z.infer<
  typeof customReportCatalogueSchema
>;

export const savedReportResponseSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  definition: z.unknown(),
  createdById: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SavedReportResponse = z.infer<typeof savedReportResponseSchema>;

export const createSavedReportInputSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(500).optional(),
  definition: z.record(z.unknown()),
});
export type CreateSavedReportInput = z.infer<
  typeof createSavedReportInputSchema
>;

export const updateSavedReportInputSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  definition: z.record(z.unknown()).optional(),
});
export type UpdateSavedReportInput = z.infer<
  typeof updateSavedReportInputSchema
>;
