import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ALLOW_MFA_ENROLLMENT_PENDING_KEY } from '../decorators/allow-mfa-enrollment-pending.decorator';
import { ALLOW_MUST_CHANGE_PASSWORD_KEY } from '../decorators/allow-must-change-password.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Enforces MFA enrollment for high-privilege roles (HR_MANAGER,
 * SUPER_ADMIN). If such a user's account has no `mfaEnabledAt`
 * (never enrolled), every non-`@AllowMfaEnrollmentPending` and
 * non-`@AllowMustChangePassword` route responds with a stable
 * `MFA_ENROLLMENT_REQUIRED` code so the FE can force-navigate to
 * `/setup-mfa`.
 *
 * The role list is intentionally narrow (regular employees never
 * hit this guard) and configured centrally in this file — changing
 * scope means editing `MANDATORY_ROLES` and a single WORKFLOW.md
 * entry. Do NOT read the env at request time.
 */
const MANDATORY_ROLES = new Set(['HR_MANAGER', 'SUPER_ADMIN']);

@Injectable()
export class MfaEnrollmentGuard implements CanActivate {
  private readonly enforce: boolean;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    // Read once at boot — flipping this at runtime would leave a
    // window where in-flight requests see one policy and new ones
    // see another. Prod always enforces (env validator refuses to
    // start with `false`).
    this.enforce = config.get<string>('MFA_ENFORCE_HR_ADMIN', 'true') !== 'false';
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.enforce) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Same `@AllowMustChangePassword` whitelist wins here — the caller
    // still needs `/auth/me`, `/auth/logout*`, `/auth/change-password`
    // and, for pre-MFA sessions, `/auth/mfa/*` (via the sibling
    // `MfaVerifiedGuard`) to walk through gate flows in any order.
    const allowMustChangePassword = this.reflector.getAllAndOverride<boolean>(
      ALLOW_MUST_CHANGE_PASSWORD_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowMustChangePassword) return true;

    const allowEnrollmentPending = this.reflector.getAllAndOverride<boolean>(
      ALLOW_MFA_ENROLLMENT_PENDING_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowEnrollmentPending) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = req.user;
    if (!user) return true;

    if (!MANDATORY_ROLES.has(user.role)) return true;

    // `mfaEnabled === false` OR undefined => not enrolled. Legacy tokens
    // (pre-30a) don't carry `mfaEnabled`; fall back to `true` (allow)
    // so we don't lock out active HR sessions until they refresh. On
    // refresh, `JwtStrategy` reads the current DB snapshot via the new
    // token and the guard starts enforcing.
    if (user.mfaEnabled === false) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'MFA_ENROLLMENT_REQUIRED',
        message:
          'Peran Anda mewajibkan MFA. Aktifkan MFA di /setup-mfa sebelum menggunakan aplikasi.',
      });
    }

    return true;
  }
}
