import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import * as Sentry from '@sentry/nestjs';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import type { UserRole } from '../../common/types/user-role';
import { USER_ROLES } from '../../common/types/user-role';

interface JwtPayload {
  sub: string;
  email: string;
  companyId: string;
  departmentId: string | null;
  role: UserRole;
  /**
   * Baked into the access token so the guard doesn't need a DB roundtrip
   * on every request. Consequence: after an admin-issued reset, an active
   * access token still shows `false` for up to `JWT_EXPIRES_IN` (15m).
   * That gap is closed by revoking refresh tokens on admin reset — the
   * client is forced to re-login within the access-token lifetime.
   */
  mustChangePassword?: boolean;
  /**
   * See `AuthenticatedUser.mfaPassed`. Legacy tokens predate this claim;
   * `validate()` coerces missing values to `true` (fail open — those
   * users have never had MFA and would otherwise be permanently locked).
   */
  mfaPassed?: boolean;
  /**
   * See `AuthenticatedUser.mfaEnabled`. Snapshot of `mfaEnabledAt !== null`
   * at token issuance. Together with `mfaPassed` it tells the guard
   * whether the current step-up state is (enrolled + passed), (enrolled +
   * pending), or (not enrolled).
   */
  mfaEnabled?: boolean;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    if (!payload?.sub || !payload.companyId || !USER_ROLES.includes(payload.role)) {
      throw new UnauthorizedException('UNAUTHORIZED');
    }
    // Attach user context to the current Sentry scope so any downstream
    // exception (raised in a service, filter, or interceptor) is tagged with
    // the actor. `setUser` is scoped per-request when Sentry runs under the
    // NestJS integration — no cross-request leakage.
    Sentry.setUser({ id: payload.sub, email: payload.email });
    Sentry.setTag('companyId', payload.companyId);
    Sentry.setTag('role', payload.role);
    return {
      id: payload.sub,
      email: payload.email,
      companyId: payload.companyId,
      departmentId: payload.departmentId,
      role: payload.role,
      mustChangePassword: payload.mustChangePassword === true,
      // Legacy tokens (issued before MFA rollout) have no `mfaPassed`
      // claim; treat missing as `true` so we don't lock out sessions
      // that predate this feature. Guards MUST use `=== false` to
      // reject, never `!mfaPassed`.
      mfaPassed: payload.mfaPassed !== false,
      mfaEnabled: payload.mfaEnabled === true,
    };
  }
}
