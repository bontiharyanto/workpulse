import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ALLOW_MUST_CHANGE_PASSWORD_KEY } from '../decorators/allow-must-change-password.decorator';
import { ALLOW_UNVERIFIED_MFA_KEY } from '../decorators/allow-unverified-mfa.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Blocks every authenticated request when the caller's JWT reports
 * `mfaPassed === false`, except routes explicitly tagged with
 * `@AllowUnverifiedMfa()`.
 *
 * Registration order matters — this guard MUST run AFTER `JwtAuthGuard`
 * (which populates `req.user`), AFTER `MustChangePasswordGuard` (so a
 * temp-password caller still lands on `/change-password` regardless of
 * MFA state), and BEFORE `RolesGuard` (so a "you need HR" 403 is not
 * shown to a caller who first needs to clear MFA).
 *
 * The error payload uses a stable `MFA_REQUIRED` code so the frontend
 * can distinguish this state from an ordinary 403 and force-navigate
 * to `/login/mfa`.
 *
 * Legacy tokens issued before this feature carry no `mfaPassed` claim
 * — `JwtStrategy` coerces `undefined` to `true`, so those sessions
 * flow through unaffected.
 */
@Injectable()
export class MfaVerifiedGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const allowUnverified = this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED_MFA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowUnverified) return true;

    // Routes that let a temp-password user through also let a pre-MFA
    // user through — `/auth/me`, `/auth/logout*`. Keeps guard behavior
    // symmetric so we don't accidentally lock the FE out of bootstrap.
    const allowMustChangePassword = this.reflector.getAllAndOverride<boolean>(
      ALLOW_MUST_CHANGE_PASSWORD_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowMustChangePassword) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = req.user;
    if (!user) return true;

    // Explicitly `=== false` — undefined defaults to allowed (legacy).
    if (user.mfaPassed === false) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'MFA_REQUIRED',
        message: 'Verifikasi kode MFA Anda untuk melanjutkan. Kunjungi /login/mfa.',
      });
    }

    return true;
  }
}
