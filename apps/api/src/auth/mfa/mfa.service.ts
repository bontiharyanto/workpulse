import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import * as QRCode from 'qrcode';

import { PasswordService } from '../password.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from '../token.service';

import {
  generateBackupCodes,
  hashBackupCode,
  normalizeBackupCode,
} from './domain/backup-codes';
import {
  decodeEncryptionKey,
  decryptString,
  encryptString,
} from './domain/crypto';
import { generateTotpEnrollment, verifyTotp } from './domain/totp';

export interface MfaStatus {
  enabled: boolean;
  enabledAt: Date | null;
  remainingBackupCodes: number;
}

export interface StartEnrollmentResult {
  otpauthUrl: string;
  qrCodeDataUri: string;
  secret: string;
}

export interface ConfirmEnrollmentResult {
  backupCodes: string[];
  accessToken: string;
  accessTokenExpiresIn: number;
}

export interface VerifyResult {
  accessToken: string;
  accessTokenExpiresIn: number;
  usedBackupCode: boolean;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);
  private readonly encryptionKey: Buffer | null;
  private readonly issuer: string;
  private readonly backupCodesCount: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tokens: TokenService,
    private readonly password: PasswordService,
  ) {
    const raw = this.config.get<string>('MFA_SECRET_ENCRYPTION_KEY');
    this.encryptionKey = raw ? decodeEncryptionKey(raw) : null;
    this.issuer = this.config.get<string>('MFA_ISSUER', 'Workpulse');
    this.backupCodesCount = Number(
      this.config.get<number>('MFA_BACKUP_CODES_COUNT', 8),
    );
    if (!this.encryptionKey && this.config.get<string>('NODE_ENV') === 'production') {
      // Env validation should catch this earlier — belt & suspenders.
      throw new Error('MFA_SECRET_ENCRYPTION_KEY is required in production');
    }
  }

  /**
   * Phase 1 of enrollment. Generates a fresh secret, encrypts it, and
   * writes it to `User.mfaSecret` WITHOUT activating MFA
   * (`mfaEnabledAt` stays null). If the user abandons the flow, the
   * next call simply overwrites the pending secret — nothing to clean
   * up. If they already have MFA active, we refuse: they must disable
   * first (and re-authenticate with the disable endpoint).
   */
  async startEnrollment(userId: string): Promise<StartEnrollmentResult> {
    const user = await this.loadUserOrThrow(userId);

    if (user.mfaEnabledAt !== null) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'MFA_ALREADY_ENABLED',
        message: 'MFA sudah aktif. Nonaktifkan terlebih dahulu untuk enroll ulang.',
      });
    }

    const key = this.requireKey();
    const { secret, otpauthUrl } = generateTotpEnrollment({
      accountName: user.email,
      issuer: this.issuer,
    });
    const encrypted = encryptString(secret, key);

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: encrypted },
    });

    // Rendered server-side so the FE never touches the raw secret nor
    // needs a client-side QR library. `image/png` base64 data URI is a
    // ~1.5 KB payload — fine to inline in JSON.
    const qrCodeDataUri = await QRCode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
    });

    return { otpauthUrl, qrCodeDataUri, secret };
  }

  /**
   * Phase 2 of enrollment. Requires possession of a currently-valid
   * TOTP code against the pending `mfaSecret`. On success:
   *
   * 1. `mfaEnabledAt` is set to `now()`.
   * 2. A fresh batch of `MFA_BACKUP_CODES_COUNT` backup codes is
   *    generated, hashed, and persisted.
   * 3. The caller receives an audit-logged access token with
   *    `mfaEnabled=true` baked in so the enrollment guard stops
   *    blocking without a full re-login.
   * 4. Backup codes are returned in plaintext ONCE. Never again.
   */
  async confirmEnrollment(
    userId: string,
    code: string,
    ctx: { userAgent?: string; ip?: string },
  ): Promise<ConfirmEnrollmentResult> {
    const user = await this.loadUserOrThrow(userId);

    if (user.mfaSecret === null) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'MFA_ENROLLMENT_NOT_STARTED',
        message: 'Mulai enrollment terlebih dahulu.',
      });
    }
    if (user.mfaEnabledAt !== null) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'MFA_ALREADY_ENABLED',
        message: 'MFA sudah aktif.',
      });
    }

    const key = this.requireKey();
    const plainSecret = decryptString(user.mfaSecret, key);
    if (!verifyTotp(code, plainSecret)) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'MFA_INVALID_CODE',
        message: 'Kode MFA tidak valid.',
      });
    }

    const codes = generateBackupCodes(this.backupCodesCount);
    const now = new Date();

    const updatedUser = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: userId },
        data: { mfaEnabledAt: now },
      });
      // No prior codes exist (first enrollment), but be defensive
      // against replay after an interrupted flow.
      await tx.mfaBackupCode.deleteMany({ where: { userId } });
      await tx.mfaBackupCode.createMany({
        data: codes.map((c) => ({ userId, codeHash: hashBackupCode(c) })),
      });
      await tx.auditLog.create({
        data: {
          companyId: u.companyId,
          actorId: userId,
          action: 'AUTH_MFA_ENABLED',
          entityType: 'User',
          entityId: userId,
          userAgent: ctx.userAgent?.slice(0, 500),
          ip: ctx.ip,
        },
      });
      return u;
    });

    // Sign a NEW access token that reflects the current DB — critical so
    // the enrollment guard (`MfaEnrollmentGuard`) stops blocking the
    // caller on their very next request. The refresh cookie stays as-is
    // because it was already `mfaVerified=true` (we're inside a normal
    // session, not mid-login).
    const stepUp = this.tokens.signStepUpAccessTokenSnapshot(updatedUser);
    return {
      backupCodes: codes,
      accessToken: stepUp.accessToken,
      accessTokenExpiresIn: stepUp.accessTokenExpiresIn,
    };
  }

  /**
   * Mid-login step-up. Verifies EITHER a 6-digit TOTP code OR a backup
   * code, rotates the refresh family (marking the new row
   * `mfaVerified=true`), and returns the fresh token pair.
   *
   * Callers must have supplied EXACTLY one of `code` / `backupCode`;
   * the controller-level DTO enforces the shape, this method enforces
   * exclusivity.
   */
  async verifyStepUp(
    userId: string,
    input: { code?: string; backupCode?: string },
    refreshTokenRaw: string,
    ctx: { userAgent?: string; ip?: string },
  ): Promise<VerifyResult> {
    if (input.code && input.backupCode) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'MFA_INVALID_INPUT',
        message: 'Berikan salah satu: kode TOTP atau backup code.',
      });
    }
    if (!input.code && !input.backupCode) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'MFA_INVALID_INPUT',
        message: 'Kode MFA tidak boleh kosong.',
      });
    }

    const user = await this.loadUserOrThrow(userId);
    if (user.mfaEnabledAt === null || user.mfaSecret === null) {
      // Caller has a pre-MFA token but the account no longer has MFA
      // active (admin intervention?). Fail closed — force re-login.
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'MFA_NOT_ENABLED',
        message: 'MFA belum aktif untuk akun ini.',
      });
    }

    let usedBackupCode = false;

    if (input.code) {
      const key = this.requireKey();
      const plainSecret = decryptString(user.mfaSecret, key);
      if (!verifyTotp(input.code, plainSecret)) {
        throw new UnauthorizedException({
          statusCode: 401,
          code: 'MFA_INVALID_CODE',
          message: 'Kode MFA tidak valid.',
        });
      }
    } else {
      const hash = hashBackupCode(input.backupCode!);
      const row = await this.prisma.mfaBackupCode.findFirst({
        where: { userId, codeHash: hash, usedAt: null },
      });
      if (!row) {
        throw new UnauthorizedException({
          statusCode: 401,
          code: 'MFA_INVALID_CODE',
          message: 'Backup code tidak valid atau sudah digunakan.',
        });
      }
      // Race-safe consumption: `updateMany` guarded by usedAt=null so a
      // second concurrent request can't burn the same code twice.
      const consumed = await this.prisma.mfaBackupCode.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (consumed.count === 0) {
        throw new UnauthorizedException({
          statusCode: 401,
          code: 'MFA_INVALID_CODE',
          message: 'Backup code sudah digunakan.',
        });
      }
      usedBackupCode = true;
    }

    // Rotate the refresh family in step-up mode → new row is
    // mfaVerified=true, old row ROTATED, new access token carries
    // mfaPassed=true.
    const pair = await this.tokens.rotateForMfaStepUp(refreshTokenRaw, ctx);

    await this.prisma.auditLog.create({
      data: {
        companyId: user.companyId,
        actorId: userId,
        action: usedBackupCode ? 'AUTH_MFA_BACKUP_USED' : 'AUTH_MFA_VERIFIED',
        entityType: 'User',
        entityId: userId,
        userAgent: ctx.userAgent?.slice(0, 500),
        ip: ctx.ip,
      },
    });

    return {
      accessToken: pair.accessToken,
      accessTokenExpiresIn: pair.accessTokenExpiresIn,
      usedBackupCode,
      refreshToken: pair.refreshToken,
      refreshTokenExpiresAt: pair.refreshTokenExpiresAt,
    };
  }

  /**
   * Regenerate the backup-code batch. Requires a currently-valid TOTP
   * code so a stolen session cookie alone cannot mint new codes.
   * Prior codes are HARD-DELETED (not marked used) so they cannot be
   * inspected in the audit trail — this is deliberate: leaving 8
   * hashed strings behind that map to plaintext the user might have
   * jotted down is a weaker security posture than starting fresh.
   */
  async regenerateBackupCodes(
    userId: string,
    totpCode: string,
    ctx: { userAgent?: string; ip?: string },
  ): Promise<string[]> {
    const user = await this.loadUserOrThrow(userId);
    if (user.mfaEnabledAt === null || user.mfaSecret === null) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'MFA_NOT_ENABLED',
        message: 'MFA belum aktif.',
      });
    }

    const key = this.requireKey();
    const plainSecret = decryptString(user.mfaSecret, key);
    if (!verifyTotp(totpCode, plainSecret)) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'MFA_INVALID_CODE',
        message: 'Kode MFA tidak valid.',
      });
    }

    const codes = generateBackupCodes(this.backupCodesCount);

    await this.prisma.$transaction(async (tx) => {
      await tx.mfaBackupCode.deleteMany({ where: { userId } });
      await tx.mfaBackupCode.createMany({
        data: codes.map((c) => ({ userId, codeHash: hashBackupCode(c) })),
      });
      await tx.auditLog.create({
        data: {
          companyId: user.companyId,
          actorId: userId,
          action: 'AUTH_MFA_BACKUP_REGENERATED',
          entityType: 'User',
          entityId: userId,
          userAgent: ctx.userAgent?.slice(0, 500),
          ip: ctx.ip,
        },
      });
    });

    return codes;
  }

  /**
   * Disable MFA. Two-factor safety net: requires password + current
   * TOTP. Wipes `mfaSecret`, clears `mfaEnabledAt`, deletes backup
   * codes, and revokes every refresh family for the user — the caller
   * is forced back through `/login` so their next access token has
   * `mfaEnabled=false` baked in and the enrollment guard behavior for
   * their role kicks in fresh.
   */
  async disable(
    userId: string,
    currentPassword: string,
    totpCode: string,
    ctx: { userAgent?: string; ip?: string },
  ): Promise<void> {
    const user = await this.loadUserOrThrow(userId);
    if (user.mfaEnabledAt === null || user.mfaSecret === null) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'MFA_NOT_ENABLED',
        message: 'MFA belum aktif.',
      });
    }

    const passwordOk = await this.password.verify(user.passwordHash, currentPassword);
    if (!passwordOk) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Password tidak sesuai.',
      });
    }

    const key = this.requireKey();
    const plainSecret = decryptString(user.mfaSecret, key);
    if (!verifyTotp(totpCode, plainSecret)) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'MFA_INVALID_CODE',
        message: 'Kode MFA tidak valid.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.mfaBackupCode.deleteMany({ where: { userId } });
      await tx.user.update({
        where: { id: userId },
        data: { mfaSecret: null, mfaEnabledAt: null },
      });
      await tx.auditLog.create({
        data: {
          companyId: user.companyId,
          actorId: userId,
          action: 'AUTH_MFA_DISABLED',
          entityType: 'User',
          entityId: userId,
          userAgent: ctx.userAgent?.slice(0, 500),
          ip: ctx.ip,
        },
      });
    });

    // Revoke every refresh token so the mfaEnabled=true claim in
    // active JWTs is no longer trusted after their TTL. Login again
    // and the fresh token will carry mfaEnabled=false.
    await this.tokens.revokeAllForUser(userId, 'MFA_DISABLED');
  }

  async getStatus(userId: string): Promise<MfaStatus> {
    const user = await this.loadUserOrThrow(userId);
    const remainingBackupCodes = await this.prisma.mfaBackupCode.count({
      where: { userId, usedAt: null },
    });
    return {
      enabled: user.mfaEnabledAt !== null,
      enabledAt: user.mfaEnabledAt,
      remainingBackupCodes,
    };
  }

  private async loadUserOrThrow(userId: string): Promise<User> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) {
      throw new UnauthorizedException('UNAUTHORIZED');
    }
    return user;
  }

  private requireKey(): Buffer {
    if (!this.encryptionKey) {
      // Fires only when the API booted without a key AND we're in a
      // non-production env — in prod the env validator refuses to
      // start. This surfaces as 500 to the client (developer error)
      // rather than 400 (user error).
      this.logger.error(
        'MFA_SECRET_ENCRYPTION_KEY missing — cannot perform MFA crypto operations',
      );
      throw new InternalServerErrorException({
        statusCode: 500,
        code: 'MFA_NOT_CONFIGURED',
        message: 'MFA belum dikonfigurasi di server.',
      });
    }
    return this.encryptionKey;
  }
}
