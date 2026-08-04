import { z } from 'zod';

/**
 * Fase 31d — Record of Processing Activities (ROPA).
 *
 * Wire schemas for `/admin/ropa/*`. Mirror `apps/api/src/ropa/dto/ropa.dto.ts`
 * plus the response mappers in `ropa-mapper.ts`.
 */

export const ropaLegalBasisSchema = z.enum([
  'CONTRACT',
  'CONSENT',
  'LEGAL_OBLIGATION',
  'LEGITIMATE_INTEREST',
  'VITAL_INTEREST',
  'PUBLIC_TASK',
]);
export type RopaLegalBasis = z.infer<typeof ropaLegalBasisSchema>;

export const ropaVersionStatusSchema = z.enum(['DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED']);
export type RopaVersionStatus = z.infer<typeof ropaVersionStatusSchema>;

/**
 * Standard tag vocabularies. NOT enforced server-side because tenants
 * may add locale-specific categories; ship them for FE autocomplete only.
 */
export const ROPA_DATA_CATEGORIES = [
  'BASIC_IDENTITY',
  'CONTACT',
  'EMPLOYMENT',
  'FINANCIAL',
  'LOCATION',
  'DEVICE_METADATA',
  'IP_ADDRESS',
  'HEALTH_DATA',
  'BIOMETRIC',
  'CREDENTIAL_HASH',
  'MFA_SECRET_ENCRYPTED',
  'TIMESTAMP',
  'DATE_RANGE',
  'DOCTOR_NOTE_ATTACHMENT',
  'PROCESS_METADATA',
] as const;

export const ROPA_SUBJECT_CATEGORIES = ['EMPLOYEE', 'DEPENDENT', 'CANDIDATE'] as const;

// -----------------------------------------------------------------------------
// Response
// -----------------------------------------------------------------------------

export const ropaVersionResponseSchema = z.object({
  id: z.string(),
  activityId: z.string(),
  version: z.number().int().positive(),
  status: ropaVersionStatusSchema,
  name: z.string(),
  purpose: z.string(),
  legalBasis: ropaLegalBasisSchema,
  legalBasisDetail: z.string().nullable(),
  dataCategories: z.array(z.string()),
  subjectCategories: z.array(z.string()),
  recipients: z.array(z.string()),
  retentionPeriod: z.string(),
  crossBorderTransfer: z.boolean(),
  crossBorderDetail: z.string().nullable(),
  securityMeasures: z.string(),
  notes: z.string().nullable(),

  createdById: z.string().nullable(),
  createdAt: z.string(),
  reviewedById: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  publishedById: z.string().nullable(),
  publishedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
});
export type RopaVersionResponse = z.infer<typeof ropaVersionResponseSchema>;

export const ropaActivityListItemSchema = z.object({
  activityId: z.string(),
  slug: z.string(),
  currentVersion: ropaVersionResponseSchema.nullable(),
  draftVersion: ropaVersionResponseSchema.nullable(),
  reviewVersion: ropaVersionResponseSchema.nullable(),
});
export type RopaActivityListItem = z.infer<typeof ropaActivityListItemSchema>;

export const ropaActivityDetailSchema = z.object({
  activityId: z.string(),
  slug: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  currentVersionId: z.string().nullable(),
  versions: z.array(ropaVersionResponseSchema),
});
export type RopaActivityDetail = z.infer<typeof ropaActivityDetailSchema>;

export const seedRopaResponseSchema = z.object({
  created: z.array(z.string()),
  skipped: z.array(z.string()),
});
export type SeedRopaResponse = z.infer<typeof seedRopaResponseSchema>;

// -----------------------------------------------------------------------------
// Requests
// -----------------------------------------------------------------------------

const trimmedString = (min: number, max: number) => z.string().trim().min(min).max(max);

export const createRopaActivityInputSchema = z.object({
  slug: trimmedString(2, 64).regex(/^[a-z0-9][a-z0-9-]{1,63}$/, {
    message: 'slug must be lowercase alphanum + hyphens, cannot start with a hyphen',
  }),
  name: trimmedString(2, 200),
  purpose: trimmedString(4, 2000),
  legalBasis: ropaLegalBasisSchema,
  legalBasisDetail: z.string().max(1000).nullable().optional(),
  dataCategories: z.array(z.string()).max(32),
  subjectCategories: z.array(z.string()).max(16),
  recipients: z.array(z.string()).max(32),
  retentionPeriod: trimmedString(2, 500),
  crossBorderTransfer: z.boolean(),
  crossBorderDetail: z.string().max(2000).nullable().optional(),
  securityMeasures: trimmedString(2, 2000),
  notes: z.string().max(2000).nullable().optional(),
});
export type CreateRopaActivityInput = z.infer<typeof createRopaActivityInputSchema>;

export const updateRopaVersionInputSchema = z.object({
  name: trimmedString(2, 200).optional(),
  purpose: trimmedString(4, 2000).optional(),
  legalBasis: ropaLegalBasisSchema.optional(),
  legalBasisDetail: z.string().max(1000).nullable().optional(),
  dataCategories: z.array(z.string()).max(32).optional(),
  subjectCategories: z.array(z.string()).max(16).optional(),
  recipients: z.array(z.string()).max(32).optional(),
  retentionPeriod: trimmedString(2, 500).optional(),
  crossBorderTransfer: z.boolean().optional(),
  crossBorderDetail: z.string().max(2000).nullable().optional(),
  securityMeasures: trimmedString(2, 2000).optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type UpdateRopaVersionInput = z.infer<typeof updateRopaVersionInputSchema>;
