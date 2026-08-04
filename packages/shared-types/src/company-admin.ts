import { z } from 'zod';

/**
 * Cross-tenant admin surface for `Company` — used by `/admin/companies`
 * (plural), gated to SUPER_ADMIN. Distinct from the tenant-scoped config
 * surface in `./company.ts` (singular) that HR + SUPER_ADMIN share.
 *
 * These schemas mirror the NestJS DTOs in
 * `apps/api/src/company-admin/dto/*` — keep them in sync when adding
 * fields.
 */

// ---------------------------------------------------------------------------
// Slug validation shared by create + update
// ---------------------------------------------------------------------------

/**
 * Same regex as `apps/api/src/company-admin/domain/slug.ts`. Kept literal
 * (not re-exported) so the wire contract is inspectable in one place.
 */
const slugSchema = z
  .string()
  .trim()
  .min(2, 'Slug minimal 2 karakter')
  .max(40, 'Slug maksimum 40 karakter')
  .regex(/^[a-z0-9-]+$/, 'Slug hanya boleh huruf kecil, angka, dan tanda "-"');

/**
 * Optional slug that gracefully accepts the empty-string coming out of an
 * uncontrolled `<input>`. Without this preprocess, react-hook-form sends
 * `slug: ""` even when the user never touched the field, and `.optional()`
 * alone would reject it against `.min(2)`.
 */
const slugSchemaOptional = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  slugSchema.optional(),
);

const nameSchema = z
  .string()
  .trim()
  .min(2, 'Nama minimal 2 karakter')
  .max(120, 'Nama maksimum 120 karakter');

const timezoneSchema = z
  .string()
  .trim()
  .min(1, 'Timezone wajib diisi')
  .max(64, 'Timezone maksimum 64 karakter');

/** Same empty-string tolerance as `slugSchemaOptional`, but for `timezone`. */
const timezoneSchemaOptional = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  timezoneSchema.optional(),
);

// ---------------------------------------------------------------------------
// DTO returned by GET /admin/companies + list envelope
// ---------------------------------------------------------------------------

export const companyAdminSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  timezone: z.string(),
  deletedAt: z.string().nullable(),
  userCount: z.number().int().nonnegative(),
  departmentCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CompanyAdmin = z.infer<typeof companyAdminSchema>;

export const listCompaniesResponseSchema = z.object({
  items: z.array(companyAdminSchema),
  totalCount: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ListCompaniesResponse = z.infer<typeof listCompaniesResponseSchema>;

// ---------------------------------------------------------------------------
// Bootstrap response (POST /admin/companies)
// ---------------------------------------------------------------------------

export const companyBootstrapSchema = z.object({
  company: companyAdminSchema,
  hrUserId: z.string(),
  hrEmail: z.string().email(),
  hrFullName: z.string(),
  /**
   * One-time temp password. UI MUST render it via the shared
   * `CredentialReveal` component and MUST NOT persist it anywhere
   * (localStorage, query cache, error logs).
   */
  temporaryPassword: z.string(),
  seededLeaveTypeCodes: z.array(z.string()).optional(),
});
export type CompanyBootstrap = z.infer<typeof companyBootstrapSchema>;

// ---------------------------------------------------------------------------
// Inputs (validated on the FE before hitting the API)
// ---------------------------------------------------------------------------

export const createCompanyInputSchema = z.object({
  name: nameSchema,
  slug: slugSchemaOptional,
  timezone: timezoneSchemaOptional,
  hrEmail: z.string().email('Format email tidak valid').max(190),
  hrFullName: z
    .string()
    .trim()
    .min(2, 'Nama HR minimal 2 karakter')
    .max(120, 'Nama HR maksimum 120 karakter'),
});
export type CreateCompanyInput = z.infer<typeof createCompanyInputSchema>;

export const updateCompanyInputSchema = z
  .object({
    name: nameSchema.optional(),
    slug: slugSchemaOptional,
    timezone: timezoneSchemaOptional,
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Setidaknya satu field harus diisi',
  });
export type UpdateCompanyInput = z.infer<typeof updateCompanyInputSchema>;

// ---------------------------------------------------------------------------
// Query params for GET /admin/companies
// ---------------------------------------------------------------------------

export const listCompaniesQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  includeDeleted: z.boolean().optional(),
  search: z.string().optional(),
});
export type ListCompaniesQuery = z.infer<typeof listCompaniesQuerySchema>;
