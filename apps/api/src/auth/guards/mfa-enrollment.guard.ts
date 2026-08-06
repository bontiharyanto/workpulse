import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { SecurityPolicyService } from '../../security-policy/security-policy.service';
import { ALLOW_MFA_ENROLLMENT_PENDING_KEY } from '../decorators/allow-mfa-enrollment-pending.decorator';
import { ALLOW_MUST_CHANGE_PASSWORD_KEY } from '../decorators/allow-must-change-password.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Enforces MFA enrollment for high-privilege roles (HR_MANAGER,
 * SUPER_ADMIN) — but ONLY when the caller's tenant has
 * `SecurityPolicy.mfaEnforceHighPrivileged=true`.
 *
 * Migration (2026-08-06): what used to be a global env
 * (`MFA_ENFORCE_HR_ADMIN`) is now a **per-tenant DB toggle** owned
 * by `SecurityPolicyService`. The env is consulted only when a
 * fresh tenant's row is first materialised — see the service for
 * the bootstrap contract.
 *
 * MVP policy (see ADR-0017 revision): MFA is opt-in for every role
 * by default. Users who choose to enroll (via `/settings/security`)
 * still get challenged by `MfaVerifiedGuard` at every login; this
 * guard only decides whether the enrollment itself is forced on
 * the user's first request after the tenant flips its policy.
 */
const MANDATORY_ROLES = new Set(['HR_MANAGER', 'SUPER_ADMIN']);

@Injectable()
export class MfaEnrollmentGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly securityPolicy: SecurityPolicyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

    // Fetch tenant policy — cached in-process, so this is essentially
    // free (see `SecurityPolicyService.getForCompany`).
    const policy = await this.securityPolicy.getForCompany(user.companyId);
    if (!policy.mfaEnforceHighPrivileged) return true;

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
