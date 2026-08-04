import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import { PasswordService } from './password.service';
import type { IssuedTokenPair, TokenContext } from './token.service';
import { TokenService } from './token.service';

export interface LoginInput {
  email: string;
  password: string;
}

export interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Verifies credentials and issues an access + refresh token pair.
   * Uses a generic UNAUTHORIZED error regardless of whether email or password was wrong
   * (mitigates account-enumeration).
   */
  async login(
    input: LoginInput,
    ctx: TokenContext,
  ): Promise<{
    user: AuthenticatedUser;
    tokens: IssuedTokenPair;
    mfaRequired: boolean;
  }> {
    const normalizedEmail = input.email.trim().toLowerCase();

    const user = await this.prisma.user.findFirst({
      where: { email: normalizedEmail, deletedAt: null },
    });

    // Always run argon2.verify to keep response time constant even when email is unknown.
    const verified = user
      ? await this.password.verify(user.passwordHash, input.password)
      : await this.password.verify(FAKE_ARGON2_HASH, input.password);

    if (!user || !verified) {
      throw new UnauthorizedException('UNAUTHORIZED');
    }

    if (user.employmentStatus === 'TERMINATED' || user.employmentStatus === 'SUSPENDED') {
      throw new UnauthorizedException('UNAUTHORIZED');
    }

    // Opportunistic rehash on login if the stored parameters are below current policy.
    if (this.password.needsRehash(user.passwordHash)) {
      const newHash = await this.password.hash(input.password);
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
    }

    // MFA gate. If the user has enrolled a second factor
    // (`mfaEnabledAt !== null`), the token pair issued here carries
    // `mfaPassed=false` and only unlocks the `/auth/mfa/verify`
    // endpoint. The FE keys off `LoginResponse.mfaRequired` to jump to
    // the second-factor screen instead of `/`.
    const mfaRequired = user.mfaEnabledAt !== null;
    const tokens = await this.tokens.issueForLogin(user, ctx, {
      mfaPassed: !mfaRequired,
    });

    await this.writeAuditLog(user, 'AUTH_LOGIN', { userAgent: ctx.userAgent, ip: ctx.ip });

    return { user: toAuthenticatedUser(user, { mfaPassed: !mfaRequired }), tokens, mfaRequired };
  }

  async refresh(rawRefreshToken: string, ctx: TokenContext): Promise<IssuedTokenPair> {
    return this.tokens.rotate(rawRefreshToken, ctx);
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    await this.tokens.revokeByRaw(rawRefreshToken);
  }

  async logoutAllDevices(userId: string): Promise<void> {
    await this.tokens.revokeAllForUser(userId, 'USER_LOGOUT_ALL');
  }

  async findById(userId: string): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    return user ? toAuthenticatedUser(user, {}) : null;
  }

  /**
   * Self-service password change. Verifies `currentPassword` before mutating,
   * clears the `mustChangePassword` flag, and revokes every active refresh
   * token so all other devices are logged out. The caller must re-login on
   * this device too — the current refresh cookie is invalidated.
   *
   * Same generic error code (`INVALID_CREDENTIALS`) is used for both
   * "user not found" and "wrong current password" to avoid leaking whether
   * the account exists to a caller who has only stolen an access token.
   */
  async changePassword(input: ChangePasswordInput, ctx: TokenContext): Promise<void> {
    if (input.currentPassword === input.newPassword) {
      throw new BadRequestException('SAME_PASSWORD');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: input.userId, deletedAt: null },
    });
    if (!user) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    const ok = await this.password.verify(user.passwordHash, input.currentPassword);
    if (!ok) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    const newHash = await this.password.hash(input.newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          mustChangePassword: false,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: user.companyId,
          actorId: user.id,
          action: 'AUTH_PASSWORD_CHANGED',
          entityType: 'User',
          entityId: user.id,
          userAgent: ctx.userAgent?.slice(0, 500),
          ip: ctx.ip,
        },
      });
    });

    // Revoke every device — the user must reauthenticate with the new
    // password. Consistent with the email-based reset flow.
    await this.tokens.revokeAllForUser(user.id, 'PASSWORD_CHANGED_SELF');
  }

  private async writeAuditLog(
    user: User,
    action: string,
    meta: { userAgent?: string; ip?: string },
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          companyId: user.companyId,
          actorId: user.id,
          action,
          entityType: 'User',
          entityId: user.id,
          userAgent: meta.userAgent?.slice(0, 500),
          ip: meta.ip,
          afterJson: { role: user.role } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn({
        message: 'audit log write failed (non-fatal)',
        action,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function toAuthenticatedUser(user: User, opts: { mfaPassed?: boolean } = {}): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    companyId: user.companyId,
    departmentId: user.departmentId,
    role: user.role,
    mustChangePassword: user.mustChangePassword === true,
    mfaPassed: opts.mfaPassed,
    mfaEnabled: user.mfaEnabledAt !== null,
  };
}

/**
 * A well-formed argon2id hash of a random string. Used only to make timing on
 * "unknown email" logins comparable to "known email + wrong password" logins.
 * Verified against any user input, always returns false.
 */
const FAKE_ARGON2_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$UnB4WEd1VXhCbFJmWTBHZQ$xxbhkYw31G4qX0/wHwPmBaAvGiEnH6QSSNw3+aCWLYw';
