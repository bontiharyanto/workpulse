import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ConsentService } from '../../consent/consent.service';
import { ALLOW_PENDING_CONSENT_KEY } from '../decorators/allow-pending-consent.decorator';
import { ALLOW_MUST_CHANGE_PASSWORD_KEY } from '../decorators/allow-must-change-password.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Blocks every authenticated request when the caller has not yet
 * accepted the tenant's currently-active privacy policy, except
 * routes tagged with `@AllowPendingConsent()`.
 *
 * Registration order — MUST run AFTER `MustChangePasswordGuard` +
 * `MfaEnrollmentGuard` (so those higher-priority redirects fire
 * first) and BEFORE `RolesGuard`.
 *
 * The 403 payload uses a stable `CONSENT_REQUIRED` code so the
 * frontend can force-navigate to `/consent` without mistaking it
 * for an ordinary permission denial.
 */
@Injectable()
export class ConsentAcceptedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly consent: ConsentService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Routes on the mustChangePassword whitelist ALSO bypass the
    // consent gate — a user still in the password-rotation flow
    // must be able to reach `/auth/me`, `/auth/logout`, etc.
    const bypasses = [
      ALLOW_PENDING_CONSENT_KEY,
      ALLOW_MUST_CHANGE_PASSWORD_KEY,
    ];
    for (const key of bypasses) {
      const allow = this.reflector.getAllAndOverride<boolean>(key, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (allow) return true;
    }

    const req = context.switchToHttp().getRequest<
      Request & { user?: AuthenticatedUser }
    >();
    const user = req.user;
    if (!user) return true; // upstream JWT guard already denied

    const pending = await this.consent.getPendingConsentForUser(
      user.id,
      user.companyId,
    );
    if (!pending) return true;

    throw new ForbiddenException({
      statusCode: 403,
      code: 'CONSENT_REQUIRED',
      message:
        'Anda perlu menerima kebijakan privasi terbaru sebelum melanjutkan. Kunjungi /consent.',
      details: { policyId: pending.id, version: pending.version },
    });
  }
}
