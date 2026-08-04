import { SetMetadata } from '@nestjs/common';

export const ALLOW_UNVERIFIED_MFA_KEY = 'workpulse:allowUnverifiedMfa';

/**
 * Marks a route (or controller) as reachable even when the caller's JWT
 * carries `mfaPassed=false`. Reserved for the tiny set of routes needed
 * while walking the user through the second factor:
 *
 *   • POST /auth/mfa/verify   — actually completing the step-up
 *   • GET  /auth/me           — FE bootstrap
 *   • POST /auth/logout       — abandon the login attempt
 *   • POST /auth/logout-all   — panic button
 *
 * ALL other authenticated routes are blocked by `MfaVerifiedGuard`
 * regardless of the caller's role when their session has not yet
 * cleared the second factor.
 */
export const AllowUnverifiedMfa = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_UNVERIFIED_MFA_KEY, true);
