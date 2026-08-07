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
  updatedAt: z.string(),
  updatedById: z.string().nullable(),
});
export type SecurityPolicyDto = z.infer<typeof securityPolicySchema>;

export const updateSecurityPolicyInputSchema = z.object({
  mfaEnforceHighPrivileged: z.boolean().optional(),
});
export type UpdateSecurityPolicyInput = z.infer<typeof updateSecurityPolicyInputSchema>;
