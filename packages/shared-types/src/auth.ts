import { z } from 'zod';

import { pendingConsentSchema } from './consent.js';

export const userRoleSchema = z.enum(['EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const loginInputSchema = z.object({
  email: z.string().trim().toLowerCase().email({ message: 'Format email tidak valid' }).max(255),
  password: z.string().min(8, { message: 'Password minimal 8 karakter' }).max(256),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const authenticatedUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  companyId: z.string(),
  departmentId: z.string().nullable(),
  role: userRoleSchema,
  /**
   * When true, the client MUST redirect the user to `/change-password`
   * before any non-`/auth` API call will succeed. Cleared once the user
   * rotates the temporary credential via `POST /auth/change-password`
   * or completes the email-based reset flow.
   */
  mustChangePassword: z.boolean(),
  /**
   * True when the user has enrolled a TOTP second factor. Combined with
   * `mfaPassed === false` on the wire, indicates the current session
   * still needs to complete `POST /auth/mfa/verify`.
   */
  mfaEnabled: z.boolean(),
  /**
   * False iff the access token backing this response is pre-MFA. The FE
   * force-routes to `/login/mfa` while this is `false`. Optional in the
   * schema for backwards compatibility with earlier client caches.
   */
  mfaPassed: z.boolean().optional(),
  /**
   * True when the caller is a high-privilege role that MUST enroll a
   * second factor before the app is usable. Mirrors the backend
   * `MfaEnrollmentGuard`'s decision (which also honours
   * `MFA_ENFORCE_HR_ADMIN`), so the FE can pre-empt the 403 without
   * duplicating the role list. Optional for compatibility with client
   * caches predating the field.
   */
  mfaEnrollmentRequired: z.boolean().optional(),
  /**
   * Non-null when the caller has NOT accepted the tenant's currently
   * active privacy policy. The FE MUST redirect to `/consent` and
   * `POST /me/consent` before any non-`/auth/*`, non-`/me/consent/*`
   * endpoint will accept the caller.
   *
   * Optional in the schema for compatibility with client caches
   * predating Fase 31c.
   */
  pendingConsent: pendingConsentSchema.nullable().optional(),
});
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresIn: z.number().int().positive(),
  user: authenticatedUserSchema,
  /**
   * When `true`, the FE MUST navigate the user to `/login/mfa` and
   * `POST /auth/mfa/verify` before any other API call. The refresh
   * cookie has already been set by the server on this response.
   */
  mfaRequired: z.boolean().default(false),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const refreshResponseSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresIn: z.number().int().positive(),
});
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

// ---------------------------------------------------------------------------
// Password recovery
// ---------------------------------------------------------------------------

export const forgotPasswordInputSchema = z.object({
  email: z.string().trim().toLowerCase().email({ message: 'Format email tidak valid' }).max(255),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInputSchema>;

/**
 * The server always responds with 202 Accepted and a generic message —
 * never disclose whether the email is on file. This shape mirrors the
 * `202` response body so the frontend can display a consistent toast.
 */
export const forgotPasswordResponseSchema = z.object({
  message: z.string(),
});
export type ForgotPasswordResponse = z.infer<typeof forgotPasswordResponseSchema>;

export const resetPasswordInputSchema = z.object({
  token: z
    .string()
    .min(40)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/, { message: 'Token tidak valid' }),
  password: z.string().min(8, { message: 'Password minimal 8 karakter' }).max(256),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;

export const resetPasswordResponseSchema = z.object({
  message: z.string(),
});
export type ResetPasswordResponse = z.infer<typeof resetPasswordResponseSchema>;

// ---------------------------------------------------------------------------
// Self-service change password (POST /auth/change-password)
// Called both by users who WANT to change their password and by users
// bounced through `/change-password` because `mustChangePassword=true`.
// ---------------------------------------------------------------------------

export const changePasswordInputSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(8, { message: 'Password baru minimal 8 karakter' }).max(256),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'Password baru harus berbeda dari password lama',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;

export const changePasswordResponseSchema = z.object({
  message: z.string(),
});
export type ChangePasswordResponse = z.infer<typeof changePasswordResponseSchema>;
