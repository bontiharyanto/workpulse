import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Prisma, RefreshToken, User } from '@prisma/client';
import { RefreshTokenStatus } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import { generateRefreshSecret, hashRefreshSecret } from './domain/token-hash';

export interface IssuedTokenPair {
  accessToken: string;
  accessTokenExpiresIn: number; // seconds
  refreshToken: string; // opaque; must be sent to client only via HttpOnly cookie
  refreshTokenExpiresAt: Date;
  refreshTokenRow: RefreshToken;
}

export interface TokenContext {
  userAgent?: string;
  ip?: string;
}

interface JwtAccessPayload {
  sub: string;
  email: string;
  companyId: string;
  departmentId: string | null;
  role: AuthenticatedUser['role'];
  mustChangePassword: boolean;
  mfaPassed: boolean;
  mfaEnabled: boolean;
}

/**
 * Extra claims injected when signing an access token. Callers set
 * `mfaPassed=true` at login when MFA is not required (never enrolled)
 * OR after `/auth/mfa/verify` succeeds. Callers set it `false` for the
 * short-lived pre-MFA token that only unlocks `/auth/mfa/*` routes.
 */
export interface AccessTokenClaims {
  mfaPassed: boolean;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Sign a new access token for the given user and issue a fresh refresh-token family.
   * Called on login. The caller decides whether `mfaPassed` starts `true` (MFA not
   * enrolled) or `false` (MFA enrolled — the token is pre-MFA and only unlocks the
   * `/auth/mfa/*` routes until stepped up via `/auth/mfa/verify`).
   */
  async issueForLogin(
    user: Pick<
      User,
      'id' | 'email' | 'companyId' | 'departmentId' | 'role' | 'mustChangePassword' | 'mfaEnabledAt'
    >,
    ctx: TokenContext,
    claims: AccessTokenClaims,
  ): Promise<IssuedTokenPair> {
    const accessToken = this.signAccessToken(user, claims);
    const accessTokenExpiresIn = this.parseSecondsFromDuration(
      this.config.get<string>('JWT_EXPIRES_IN', '15m'),
    );

    const { refreshToken, refreshTokenExpiresAt, refreshTokenRow } = await this.createRefreshRow({
      userId: user.id,
      familyId: null,
      replacesId: null,
      ctx,
      mfaVerified: claims.mfaPassed,
    });

    return {
      accessToken,
      accessTokenExpiresIn,
      refreshToken,
      refreshTokenExpiresAt,
      refreshTokenRow,
    };
  }

  /**
   * Step-up rotation used by `POST /auth/mfa/verify` — same wire shape
   * as `rotate()` but ALWAYS marks the new refresh row as MFA-verified.
   * Callers MUST have proven possession of the second factor before
   * invoking this; the method does not check TOTP itself.
   */
  async rotateForMfaStepUp(rawRefreshToken: string, ctx: TokenContext): Promise<IssuedTokenPair> {
    return this.rotateInternal(rawRefreshToken, ctx, { forceMfaVerified: true });
  }

  /**
   * Sign a fresh access token WITHOUT touching the refresh cookie or
   * DB. Used after `enroll/confirm` — the caller was already MFA-
   * verified (their pre-enroll token had `mfaPassed=true`), we just
   * need the new token to carry `mfaEnabled=true` so the enrollment
   * guard stops firing. The prior access token expires normally.
   */
  signStepUpAccessTokenSnapshot(
    user: Pick<
      User,
      'id' | 'email' | 'companyId' | 'departmentId' | 'role' | 'mustChangePassword' | 'mfaEnabledAt'
    >,
  ): { accessToken: string; accessTokenExpiresIn: number } {
    const accessToken = this.signAccessToken(user, { mfaPassed: true });
    const accessTokenExpiresIn = this.parseSecondsFromDuration(
      this.config.get<string>('JWT_EXPIRES_IN', '15m'),
    );
    return { accessToken, accessTokenExpiresIn };
  }

  /**
   * Rotate a refresh token. Detects reuse of already-rotated or already-revoked tokens
   * and revokes the entire family for defense in depth.
   *
   * @throws UnauthorizedException on any invalid state (unknown, expired, reused, revoked).
   */
  async rotate(rawRefreshToken: string, ctx: TokenContext): Promise<IssuedTokenPair> {
    return this.rotateInternal(rawRefreshToken, ctx, { forceMfaVerified: false });
  }

  private async rotateInternal(
    rawRefreshToken: string,
    ctx: TokenContext,
    opts: { forceMfaVerified: boolean },
  ): Promise<IssuedTokenPair> {
    const tokenHash = hashRefreshSecret(rawRefreshToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existing) {
      throw new UnauthorizedException('UNAUTHORIZED');
    }

    // Reuse detection: any use of a token that is not ACTIVE means the token
    // was already rotated or revoked. Assume compromise → burn the family.
    if (existing.status !== RefreshTokenStatus.ACTIVE) {
      await this.revokeFamily(existing.familyId, 'REUSE_DETECTED');
      throw new UnauthorizedException('UNAUTHORIZED');
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      await this.prisma.refreshToken.update({
        where: { id: existing.id },
        data: { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() },
      });
      throw new UnauthorizedException('UNAUTHORIZED');
    }

    const user = existing.user;
    if (!user || user.deletedAt) {
      throw new UnauthorizedException('UNAUTHORIZED');
    }

    // Rotate: create a new row in the same family, mark old row ROTATED, link them.
    // MFA state is carried on the RefreshToken row itself (`mfaVerified`)
    // so rotation is faithful — a session that cleared MFA at login stays
    // MFA-verified for the whole refresh chain. A user who disables MFA
    // sees rotations produce `mfaPassed=true` regardless (no MFA to gate).
    const nextMfaVerified =
      opts.forceMfaVerified || user.mfaEnabledAt === null ? true : existing.mfaVerified === true;
    const accessToken = this.signAccessToken(user, { mfaPassed: nextMfaVerified });
    const accessTokenExpiresIn = this.parseSecondsFromDuration(
      this.config.get<string>('JWT_EXPIRES_IN', '15m'),
    );

    return this.prisma.$transaction(async (tx) => {
      const { refreshToken, refreshTokenExpiresAt, refreshTokenRow } = await this.createRefreshRow({
        userId: user.id,
        familyId: existing.familyId,
        replacesId: existing.id,
        ctx,
        tx,
        mfaVerified: nextMfaVerified,
      });

      await tx.refreshToken.update({
        where: { id: existing.id },
        data: {
          status: RefreshTokenStatus.ROTATED,
          replacedById: refreshTokenRow.id,
          revokedAt: new Date(),
        },
      });

      return {
        accessToken,
        accessTokenExpiresIn,
        refreshToken,
        refreshTokenExpiresAt,
        refreshTokenRow,
      };
    });
  }

  /** Revoke a specific refresh token (best-effort logout on this device only). */
  async revokeByRaw(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashRefreshSecret(rawRefreshToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!existing || existing.status !== RefreshTokenStatus.ACTIVE) return;
    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() },
    });
  }

  /** Revoke every active token of a user (used for global logout / password change). */
  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    this.logger.warn({ message: 'revoking all refresh tokens for user', userId, reason });
    await this.prisma.refreshToken.updateMany({
      where: { userId, status: RefreshTokenStatus.ACTIVE },
      data: { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() },
    });
  }

  private async revokeFamily(familyId: string, reason: string): Promise<void> {
    this.logger.warn({ message: 'reuse detected — revoking family', familyId, reason });
    await this.prisma.refreshToken.updateMany({
      where: { familyId, status: { in: [RefreshTokenStatus.ACTIVE, RefreshTokenStatus.ROTATED] } },
      data: { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() },
    });
  }

  private signAccessToken(
    user: Pick<
      User,
      'id' | 'email' | 'companyId' | 'departmentId' | 'role' | 'mustChangePassword' | 'mfaEnabledAt'
    >,
    claims: AccessTokenClaims,
  ): string {
    const payload: JwtAccessPayload = {
      sub: user.id,
      email: user.email,
      companyId: user.companyId,
      departmentId: user.departmentId,
      role: user.role,
      mustChangePassword: user.mustChangePassword === true,
      mfaPassed: claims.mfaPassed,
      mfaEnabled: user.mfaEnabledAt !== null,
    };
    return this.jwt.sign(payload);
  }

  private async createRefreshRow(args: {
    userId: string;
    familyId: string | null;
    replacesId: string | null;
    ctx: TokenContext;
    tx?: Prisma.TransactionClient;
    mfaVerified: boolean;
  }): Promise<{
    refreshToken: string;
    refreshTokenExpiresAt: Date;
    refreshTokenRow: RefreshToken;
  }> {
    const secret = generateRefreshSecret();
    const tokenHash = hashRefreshSecret(secret);
    const ttlMs =
      this.parseSecondsFromDuration(this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d')) * 1000;
    const expiresAt = new Date(Date.now() + ttlMs);

    const db = args.tx ?? this.prisma;
    const row = await db.refreshToken.create({
      data: {
        userId: args.userId,
        familyId: args.familyId ?? '__pending__',
        tokenHash,
        expiresAt,
        userAgent: args.ctx.userAgent?.slice(0, 500),
        ip: args.ctx.ip,
        mfaVerified: args.mfaVerified,
      },
    });

    // On first token in a family, familyId := row.id
    const finalRow =
      args.familyId === null
        ? await db.refreshToken.update({
            where: { id: row.id },
            data: { familyId: row.id },
          })
        : row;

    return { refreshToken: secret, refreshTokenExpiresAt: expiresAt, refreshTokenRow: finalRow };
  }

  /** Parses "15m", "7d", "3600s", or a bare number of seconds. */
  private parseSecondsFromDuration(input: string): number {
    if (/^\d+$/.test(input)) return Number(input);
    const match = input.match(/^(\d+)\s*(s|m|h|d)$/i);
    if (!match) return 900;
    const value = Number(match[1]);
    const unit = match[2]?.toLowerCase();
    switch (unit) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 3600;
      case 'd':
        return value * 86400;
      default:
        return 900;
    }
  }
}
