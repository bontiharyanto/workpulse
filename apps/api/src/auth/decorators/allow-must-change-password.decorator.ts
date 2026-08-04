import { SetMetadata } from '@nestjs/common';

export const ALLOW_MUST_CHANGE_PASSWORD_KEY = 'workpulse:allowMustChangePassword';

/**
 * Marks a route (or controller) as reachable even when the caller has
 * `mustChangePassword=true`. Reserved for the tiny set of routes the FE
 * needs while walking the user through rotation — `POST /auth/change-password`,
 * `GET /auth/me`, `POST /auth/logout`, `POST /auth/logout-all`.
 *
 * ALL other authenticated routes are blocked by `MustChangePasswordGuard`
 * regardless of the caller's role.
 */
export const AllowMustChangePassword = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_MUST_CHANGE_PASSWORD_KEY, true);
