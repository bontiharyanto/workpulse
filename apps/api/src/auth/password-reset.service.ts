import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { RefreshTokenStatus } from '@prisma/client';

import { passwordResetSucceeded } from '../notification/domain/templates';
import { EMAIL_ADAPTER, type EmailAdapter } from '../notification/email/email-adapter';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildResetLinkEmail } from './domain/reset-email';
import {
  generateResetToken,
  hashResetToken,
  looksLikeResetToken,
  RESET_TOKEN_TTL_MINUTES,
} from './domain/reset-token';
import { PasswordService } from './password.service';

export interface RequestResetInput {
  email: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface ResetPasswordInput {
  rawToken: string;
  newPassword: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Forgot-password / reset-password flow.
 *
 * ## Security invariants
 *
 * 1. **No user enumeration.** `requestReset` NEVER signals whether the
 *    email exists. The response body from the controller is identical
 *    in both cases; internally we log the discrepancy at `debug`.
 *
 * 2. **Constant-ish timing.** When the email is unknown we still do a
 *    small amount of hashing work (a cheap SHA-256, since we don't want
 *    to burn argon2 on obvious probes) so that request duration doesn't
 *    trivially separate the two cases at the network layer.
 *
 * 3. **Single-use tokens.** `usedAt` is set inside the same transaction
 *    that changes the password; a replay is guaranteed to fail.
 *
 * 4. **Global session kill.** On successful reset every ACTIVE refresh
 *    token for the user is REVOKED. If the attacker was the one who
 *    triggered the reset, this evicts the legit user's live sessions
 *    (small usability cost, big security win). If the legit user
 *    triggered it, they'll just log in again.
 *
 * 5. **Rate limiting** lives at the controller (@Throttle) — the
 *    service assumes it's being called at a reasonable rate.
 *
 * 6. **Reset link email is not persisted as a Notification.** The link
 *    embeds the raw token, which we don't want stored server-side. Only
 *    the SHA-256 hash lives in the DB.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
  ) {}

  /**
   * Issue a reset token (if the account exists) and send it via email.
   * Returns void; the controller MUST return an identical response body
   * whether or not the account was found.
   */
  async requestReset(input: RequestResetInput): Promise<void> {
    const normalizedEmail = input.email.trim().toLowerCase();

    const user = await this.prisma.user.findFirst({
      where: { email: normalizedEmail, deletedAt: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        employmentStatus: true,
      },
    });

    // No user, or user is TERMINATED/SUSPENDED → silently succeed so the
    // caller can't infer state. We deliberately DO NOT throw here.
    if (!user || user.employmentStatus === 'TERMINATED' || user.employmentStatus === 'SUSPENDED') {
      // Do a tiny bit of work to normalise timing — this is not
      // security-sensitive, just a mild timing-oracle mitigation.
      hashResetToken(normalizedEmail);
      this.logger.debug({
        message: 'password reset requested for non-existent or inactive account',
        email: normalizedEmail,
      });
      return;
    }

    const { rawToken, tokenHash } = generateResetToken();
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        requestedIp: input.ipAddress ?? null,
        requestedUserAgent: input.userAgent?.slice(0, 500) ?? null,
      },
    });

    const resetUrl = this.buildResetUrl(rawToken);
    const emailContent = buildResetLinkEmail({
      toEmail: user.email,
      displayName: user.fullName,
      resetUrl,
      expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
    });

    // Fire-and-forget — EmailAdapter contract is "must not throw".
    this.email
      .send({
        to: emailContent.to,
        subject: emailContent.subject,
        body: emailContent.body,
      })
      .catch((err) => {
        this.logger.warn(
          `password-reset email dispatch failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }

  /**
   * Consume a reset token and update the password. Throws
   * `BadRequestException('INVALID_TOKEN')` for any failure — unknown,
   * expired, used, or malformed — so the client can't distinguish
   * between them.
   *
   * On success:
   *   - Password is updated (argon2id).
   *   - Token is marked used.
   *   - Every ACTIVE refresh token for the user is REVOKED.
   *   - An audit log entry is written.
   *   - A confirmation `Notification` is created (in-app + email via
   *     the standard NotificationService fan-out).
   */
  async resetPassword(input: ResetPasswordInput): Promise<void> {
    if (!looksLikeResetToken(input.rawToken)) {
      throw new BadRequestException('INVALID_TOKEN');
    }

    const tokenHash = hashResetToken(input.rawToken);
    const now = new Date();

    // Load the token + user in one query; the FK guarantees the join is safe.
    const tokenRow = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            companyId: true,
            fullName: true,
            employmentStatus: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!tokenRow) throw new BadRequestException('INVALID_TOKEN');
    if (tokenRow.usedAt) throw new BadRequestException('INVALID_TOKEN');
    if (tokenRow.expiresAt.getTime() < now.getTime()) {
      throw new BadRequestException('INVALID_TOKEN');
    }

    const user = tokenRow.user;
    if (!user || user.deletedAt) throw new BadRequestException('INVALID_TOKEN');
    if (user.employmentStatus === 'TERMINATED' || user.employmentStatus === 'SUSPENDED') {
      // The account was disabled after issuing the token — treat as invalid.
      throw new BadRequestException('INVALID_TOKEN');
    }

    const newHash = await this.password.hash(input.newPassword);

    // All state mutations run atomically; if any fails, none apply.
    await this.prisma.$transaction(async (tx) => {
      // 1. Consume the token (guard against concurrent reuse via updateMany
      //    with a `usedAt: null` predicate). If another request already
      //    consumed it in this instant, `count` is 0 → surface as invalid.
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: tokenRow.id, usedAt: null },
        data: { usedAt: now },
      });
      if (consumed.count === 0) {
        throw new BadRequestException('INVALID_TOKEN');
      }

      // 2. Update password + clear the temp-password enforcement flag —
      //    the user just self-picked their own password via the email link,
      //    so `mustChangePassword` is no longer meaningful.
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash, mustChangePassword: false },
      });

      // 3. Revoke ALL active refresh tokens (logs them out everywhere).
      await tx.refreshToken.updateMany({
        where: { userId: user.id, status: RefreshTokenStatus.ACTIVE },
        data: { status: RefreshTokenStatus.REVOKED, revokedAt: now },
      });

      // 4. Audit log.
      await tx.auditLog.create({
        data: {
          companyId: user.companyId,
          actorId: user.id,
          action: 'AUTH_PASSWORD_RESET',
          entityType: 'User',
          entityId: user.id,
          userAgent: input.userAgent?.slice(0, 500) ?? undefined,
          ip: input.ipAddress ?? undefined,
        } satisfies Prisma.AuditLogUncheckedCreateInput,
      });

      // 5. Confirmation notification (in-app + email). We DO run this in
      //    the transaction so a DB failure rolls back both password and
      //    notification; the email dispatch itself is fire-and-forget
      //    inside NotificationService and will not hold the tx open.
      await this.notifications.createOne(
        {
          companyId: user.companyId,
          recipientId: user.id,
          recipientEmail: user.email,
          content: passwordResetSucceeded({
            ipAddress: input.ipAddress ?? null,
            userAgent: input.userAgent ?? null,
          }),
        },
        tx,
      );
    });

    // Housekeeping: invalidate any OTHER outstanding reset tokens for the
    // user so an attacker who requested a second link before the legit user
    // reset can't reuse theirs. Done outside the tx because it's not part
    // of the atomic operation — a partial cleanup here just means the
    // remaining tokens continue to be one-shot and expire naturally.
    await this.prisma.passwordResetToken
      .updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      })
      .catch((err) => {
        this.logger.warn(
          `failed to invalidate remaining reset tokens for user ${user.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }

  private buildResetUrl(rawToken: string): string {
    const base = this.config.get<string>('WEB_URL', 'http://localhost:3000');
    // `URL` constructor handles trailing slashes gracefully.
    const url = new URL('/reset-password', base);
    url.searchParams.set('token', rawToken);
    return url.toString();
  }
}
