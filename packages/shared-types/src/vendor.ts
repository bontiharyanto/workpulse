import { z } from 'zod';

/**
 * Fase 31f — Vendor / Processor Register.
 *
 * Wire schemas for `/admin/privacy/vendors/*`. Mirror the API DTOs
 * in `apps/api/src/vendor-processor/dto/vendor.dto.ts` so FE and BE
 * agree on shape.
 */

export const vendorCategorySchema = z.enum([
  'PAYROLL',
  'STORAGE',
  'EMAIL',
  'MONITORING',
  'PAYMENT',
  'HR_SUITE',
  'COMMUNICATION',
  'OTHER',
]);
export type VendorCategory = z.infer<typeof vendorCategorySchema>;

export const vendorStatusSchema = z.enum([
  'UNDER_REVIEW',
  'ACTIVE',
  'DEPRECATED',
  'TERMINATED',
]);
export type VendorStatus = z.infer<typeof vendorStatusSchema>;

export const vendorDataVolumeSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'MASSIVE']);
export type VendorDataVolume = z.infer<typeof vendorDataVolumeSchema>;

export const vendorReminderKindSchema = z.enum(['REVIEW_DUE', 'CONTRACT_EXPIRING']);
export type VendorReminderKind = z.infer<typeof vendorReminderKindSchema>;

/** Common vendor certifications — free-form, but FE offers these
 *  as autocomplete suggestions. */
export const VENDOR_CERTIFICATIONS = [
  'ISO27001',
  'ISO27017',
  'ISO27018',
  'SOC2_TYPE_I',
  'SOC2_TYPE_II',
  'PCI_DSS',
  'HIPAA',
  'GDPR_ART_28',
  'PDP_INDONESIA',
] as const;

export const isoDateTimeString = z.string().datetime({ offset: true });

// --- Requests -----------------------------------------------------

export const createVendorSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'must be kebab-case'),
  name: z.string().min(2).max(200),
  category: vendorCategorySchema,
  description: z.string().min(10).max(4000),
  dataCategories: z.array(z.string().min(1).max(64)).default([]),
  personalDataVolume: vendorDataVolumeSchema.default('LOW'),
  dataResidency: z.string().max(200).nullable().optional(),
  contactName: z.string().max(200).nullable().optional(),
  contactEmail: z.string().email().nullable().optional(),
  contactPhone: z.string().max(64).nullable().optional(),
  contractDocumentUrl: z.string().max(2048).nullable().optional(),
  contractStartAt: isoDateTimeString.nullable().optional(),
  contractEndAt: isoDateTimeString.nullable().optional(),
  dpaSignedAt: isoDateTimeString.nullable().optional(),
  subprocessorsAllowed: z.boolean().default(false),
  securityCertifications: z.array(z.string().min(1).max(64)).default([]),
  nextReviewAt: isoDateTimeString.optional(),
});
export type CreateVendorInput = z.infer<typeof createVendorSchema>;

export const updateVendorSchema = createVendorSchema.partial().extend({
  status: vendorStatusSchema.optional(),
});
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;

export const markVendorReviewedSchema = z.object({
  note: z.string().max(4000).nullable().optional(),
  /**
   * Optional explicit next review date. Omit to auto-schedule
   * `reviewedAt + DEFAULT_REVIEW_INTERVAL_DAYS`.
   */
  nextReviewAt: isoDateTimeString.optional(),
});
export type MarkVendorReviewedInput = z.infer<typeof markVendorReviewedSchema>;

export const terminateVendorSchema = z.object({
  reason: z.string().min(5).max(4000),
});
export type TerminateVendorInput = z.infer<typeof terminateVendorSchema>;

export const linkRopaSchema = z.object({
  ropaActivityId: z.string().min(1),
  note: z.string().max(2000).nullable().optional(),
});
export type LinkRopaInput = z.infer<typeof linkRopaSchema>;

// --- Responses ----------------------------------------------------

export const vendorRopaLinkSchema = z.object({
  id: z.string(),
  ropaActivityId: z.string(),
  ropaActivitySlug: z.string(),
  ropaActivityName: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: isoDateTimeString,
});
export type VendorRopaLinkDto = z.infer<typeof vendorRopaLinkSchema>;

export const vendorSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  category: vendorCategorySchema,
  status: vendorStatusSchema,
  personalDataVolume: vendorDataVolumeSchema,
  nextReviewAt: isoDateTimeString,
  contractEndAt: isoDateTimeString.nullable(),
  dpaSignedAt: isoDateTimeString.nullable(),
  linkedRopaCount: z.number().int().nonnegative(),
  updatedAt: isoDateTimeString,
});
export type VendorSummaryDto = z.infer<typeof vendorSummarySchema>;

export const vendorDetailSchema = vendorSummarySchema.extend({
  description: z.string(),
  dataCategories: z.array(z.string()),
  dataResidency: z.string().nullable(),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contractDocumentUrl: z.string().nullable(),
  contractStartAt: isoDateTimeString.nullable(),
  subprocessorsAllowed: z.boolean(),
  securityCertifications: z.array(z.string()),
  lastReviewedAt: isoDateTimeString.nullable(),
  lastReviewNote: z.string().nullable(),
  terminatedAt: isoDateTimeString.nullable(),
  terminatedReason: z.string().nullable(),
  createdAt: isoDateTimeString,
  ropaLinks: z.array(vendorRopaLinkSchema),
});
export type VendorDetailDto = z.infer<typeof vendorDetailSchema>;

export const listVendorsQuerySchema = z.object({
  status: vendorStatusSchema.optional(),
  category: vendorCategorySchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
/** Input side (limit optional) — used by the FE api-client. */
export type ListVendorsQuery = z.input<typeof listVendorsQuerySchema>;

export const listVendorsResponseSchema = z.object({
  items: z.array(vendorSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ListVendorsResponseDto = z.infer<typeof listVendorsResponseSchema>;
