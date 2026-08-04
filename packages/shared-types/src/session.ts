import { z } from 'zod';

/**
 * Shared session shapes — mirror `apps/api/src/auth/session/dto/session.dto.ts`.
 *
 * Only self-service metadata is exposed. The raw refresh-cookie hash
 * never leaves the DB, so this schema is safe to embed in bundle-shipped
 * client code.
 */
export const sessionSchema = z.object({
  id: z.string(),
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  mfaVerified: z.boolean(),
  createdAt: z.string(),
  expiresAt: z.string(),
  isCurrent: z.boolean(),
});
export type Session = z.infer<typeof sessionSchema>;

export const sessionListResponseSchema = z.object({
  sessions: z.array(sessionSchema),
});
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;

export const sessionRevokeOthersResponseSchema = z.object({
  revokedCount: z.number().int().nonnegative(),
});
export type SessionRevokeOthersResponse = z.infer<
  typeof sessionRevokeOthersResponseSchema
>;
