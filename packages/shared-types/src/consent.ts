import { z } from 'zod';

/**
 * Fase 31c — Privacy policy versions + user consent ledger. Mirrors
 * `apps/api/src/consent/dto/consent.dto.ts`.
 */
export const privacyPolicySchema = z.object({
  id: z.string(),
  companyId: z.string(),
  version: z.string(),
  title: z.string(),
  body: z.string(),
  effectiveAt: z.string(),
  publishedById: z.string().nullable(),
  createdAt: z.string(),
});
export type PrivacyPolicyDto = z.infer<typeof privacyPolicySchema>;

export const privacyPolicyListResponseSchema = z.object({
  items: privacyPolicySchema.array(),
});
export type PrivacyPolicyListResponseDto = z.infer<
  typeof privacyPolicyListResponseSchema
>;

export const publishPolicyInputSchema = z.object({
  version: z.string().min(1).max(20),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
  effectiveAt: z.string().datetime().optional(),
});
export type PublishPolicyInput = z.infer<typeof publishPolicyInputSchema>;

export const userConsentSchema = z.object({
  id: z.string(),
  policyId: z.string(),
  policyVersion: z.string(),
  policyTitle: z.string(),
  acceptedAt: z.string(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type UserConsentDto = z.infer<typeof userConsentSchema>;

export const userConsentListResponseSchema = z.object({
  items: userConsentSchema.array(),
});
export type UserConsentListResponseDto = z.infer<
  typeof userConsentListResponseSchema
>;

export const acceptConsentInputSchema = z.object({
  policyId: z.string().min(1),
});
export type AcceptConsentInput = z.infer<typeof acceptConsentInputSchema>;

/**
 * Mirrors the `pendingConsent` field on `AuthenticatedUserDto`.
 * Kept in this module (not `auth.ts`) so the FE can import it
 * standalone in the `/consent` page.
 */
export const pendingConsentSchema = z.object({
  id: z.string(),
  version: z.string(),
  title: z.string(),
  body: z.string(),
  effectiveAt: z.string(),
});
export type PendingConsentDto = z.infer<typeof pendingConsentSchema>;
