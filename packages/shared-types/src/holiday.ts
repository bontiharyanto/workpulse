import { z } from 'zod';

import { isoDateTimeSchema } from './common.js';
import { calendarDateSchema } from './leave.js';

export const holidaySchema = z.object({
  id: z.string(),
  companyId: z.string(),
  date: calendarDateSchema,
  name: z.string(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Holiday = z.infer<typeof holidaySchema>;

export const createHolidaySchema = z.object({
  date: calendarDateSchema,
  name: z.string().trim().min(2).max(120),
});
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;

export const updateHolidaySchema = z
  .object({
    date: calendarDateSchema.optional(),
    name: z.string().trim().min(2).max(120).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Setidaknya satu field harus diubah',
  });
export type UpdateHolidayInput = z.infer<typeof updateHolidaySchema>;

/**
 * Bulk import. Duplicates (same `date` within the company) are skipped, not
 * rejected — the response reports counts for observability.
 */
export const bulkImportHolidaysSchema = z.object({
  items: z
    .array(createHolidaySchema)
    .min(1, 'Minimal 1 hari libur')
    .max(500, 'Maksimum 500 hari libur per bulk import'),
});
export type BulkImportHolidaysInput = z.infer<typeof bulkImportHolidaysSchema>;

export const bulkImportHolidaysResponseSchema = z.object({
  inserted: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type BulkImportHolidaysResponse = z.infer<typeof bulkImportHolidaysResponseSchema>;
