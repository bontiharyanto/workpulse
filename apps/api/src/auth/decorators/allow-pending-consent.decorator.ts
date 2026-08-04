import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_CONSENT_KEY = 'workpulse:allowPendingConsent';

/**
 * Marks a route (or controller) as reachable even when the caller
 * has not yet accepted the tenant's active privacy policy. Reserved
 * for the tiny surface the FE needs to actually complete the
 * acceptance flow — `GET /me/consent/current`, `POST /me/consent`,
 * `GET /auth/me`, `POST /auth/logout`.
 *
 * Every other authenticated route is blocked by `ConsentAcceptedGuard`.
 */
export const AllowPendingConsent = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_PENDING_CONSENT_KEY, true);
