import { z } from 'zod';

/**
 * DSAR — mirror of `apps/api/src/data-export/dto/data-export.dto.ts`.
 * Kept intentionally narrow: nothing about the archive contents leaks
 * here (that's an implementation detail of the worker).
 */
export const dataExportStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'READY',
  'FAILED',
  'EXPIRED',
]);
export type DataExportStatus = z.infer<typeof dataExportStatusSchema>;

export const dataExportRequestSchema = z.object({
  id: z.string(),
  status: dataExportStatusSchema,
  requestedAt: z.string(),
  completedAt: z.string().nullable(),
  failedAt: z.string().nullable(),
  failureReason: z.string().nullable(),
  fileSize: z.number().int().nullable(),
  expiresAt: z.string().nullable(),
  downloadUrl: z.string().nullable(),
});
export type DataExportRequestRow = z.infer<typeof dataExportRequestSchema>;

export const dataExportListResponseSchema = z.object({
  requests: z.array(dataExportRequestSchema),
});
export type DataExportListResponse = z.infer<typeof dataExportListResponseSchema>;

export const dataExportDownloadResponseSchema = z.object({
  downloadUrl: z.string().url(),
  expiresIn: z.number().int().positive(),
});
export type DataExportDownloadResponse = z.infer<typeof dataExportDownloadResponseSchema>;
