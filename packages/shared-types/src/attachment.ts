import { z } from 'zod';

export const attachmentPurposeSchema = z.enum(['leave-attachment']);
export type AttachmentPurpose = z.infer<typeof attachmentPurposeSchema>;

/** Mirrors backend whitelist — see `apps/api/src/attachment/domain/content-type.ts`. */
export const attachmentContentTypeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);
export type AttachmentContentType = z.infer<typeof attachmentContentTypeSchema>;

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MiB (mirror backend)

export const presignPutRequestSchema = z.object({
  purpose: attachmentPurposeSchema,
  contentType: attachmentContentTypeSchema,
  sizeBytes: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES),
  filename: z.string().trim().min(1).max(200),
});
export type PresignPutRequest = z.infer<typeof presignPutRequestSchema>;

export const presignPutResponseSchema = z.object({
  uploadUrl: z.string().url(),
  fileKey: z.string().min(1),
  requiredHeaders: z.record(z.string()),
  expiresIn: z.number().int().positive(),
});
export type PresignPutResponse = z.infer<typeof presignPutResponseSchema>;
