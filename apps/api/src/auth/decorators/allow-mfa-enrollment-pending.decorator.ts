import { SetMetadata } from '@nestjs/common';

export const ALLOW_MFA_ENROLLMENT_PENDING_KEY = 'workpulse:allowMfaEnrollmentPending';

/**
 * Marks a route (or controller) as reachable by a user whose role is in
 * the "MFA-mandatory" set but who has not yet completed enrollment.
 * Reserved for the tiny set of routes needed to walk them through
 * enrollment (`/auth/mfa/*`) plus the routes already whitelisted by
 * `@AllowMustChangePassword` (`/auth/me`, `/auth/logout*`,
 * `/auth/change-password`).
 *
 * ALL other authenticated routes are blocked by `MfaEnrollmentGuard`
 * for HR_MANAGER and SUPER_ADMIN callers with `user.mfaEnabledAt` null.
 */
export const AllowMfaEnrollmentPending = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_MFA_ENROLLMENT_PENDING_KEY, true);
