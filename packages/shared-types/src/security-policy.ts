import { z } from 'zod';

/**
 * Tenant-scoped security policy. Mirrors
 * `apps/api/src/security-policy/dto/security-policy.dto.ts` and the
 * `SecurityPolicy` Prisma model. Kept intentionally small — every
 * field here is a toggle that the guard layer reads at request time
 * (with a short-TTL cache), so adding a knob has an immediate
 * runtime cost.
 */
export const securityPolicySchema = z.object({
  id: z.string(),
  companyId: z.string(),
  /**
   * When `true`, users with role `HR_MANAGER` or `SUPER_ADMIN` in
   * this tenant are forced through `/setup-mfa` before any other
   * route responds. See ADR-0017.
   */
  mfaEnforceHighPrivileged: z.boolean(),
  /**
   * ADR-0041 — master switch for the "supervisor asks user for
   * their current location" feature. Default `false`. Flipping to
   * `true` requires an APPROVED `DpiaAssessment` (activity =
   * LOCATION_SHARING) — the controller enforces that gate.
   */
  locationSharingEnabled: z.boolean(),
  /**
   * When the flag was flipped on for the first time. Never
   * cleared when the flag flips back to `false` (regulators may
   * later ask "was this ever enabled?" — we keep the answer).
   */
  locationSharingEnabledAt: z.string().nullable(),
  /**
   * SUPER_ADMIN who flipped the flag on. Retained via `SetNull`
   * on user delete.
   */
  locationSharingEnabledById: z.string().nullable(),
  /**
   * FK to the `DpiaAssessment` that gated the flip. Null iff the
   * flag was never enabled.
   */
  locationSharingDpiaId: z.string().nullable(),
  /**
   * SHA-256 hex digest of the consent-copy file the tenant
   * approved at flip time. Frozen thereafter; FE compares against
   * the current in-repo SHA and warns if drift is detected.
   */
  locationSharingConsentCopySha: z.string().nullable(),
  updatedAt: z.string(),
  updatedById: z.string().nullable(),
});
export type SecurityPolicyDto = z.infer<typeof securityPolicySchema>;

/**
 * PATCH body. `mfaEnforceHighPrivileged` is a simple toggle.
 * `locationSharing` is a nested discriminated action because
 * enabling it demands a DPIA reference and consent-copy SHA, but
 * disabling is a bare toggle.
 */
export const updateSecurityPolicyInputSchema = z.object({
  mfaEnforceHighPrivileged: z.boolean().optional(),
  locationSharing: z
    .discriminatedUnion('action', [
      z.object({
        action: z.literal('ENABLE'),
        /** DpiaAssessment.id with status = APPROVED and activity = LOCATION_SHARING. */
        dpiaId: z.string().min(1),
        /** Consent copy SHA-256 hex digest. */
        consentCopySha: z.string().length(64),
      }),
      z.object({
        action: z.literal('DISABLE'),
      }),
    ])
    .optional(),
});
export type UpdateSecurityPolicyInput = z.infer<typeof updateSecurityPolicyInputSchema>;
