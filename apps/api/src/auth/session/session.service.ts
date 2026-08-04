import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma, RefreshToken } from '@prisma/client';
import { RefreshTokenStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { hashRefreshSecret } from '../domain/token-hash';

export interface SessionSummary {
  id: string;
  userAgent: string | null;
  ip: string | null;
  mfaVerified: boolean;
  createdAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}

/**
 * Read + revoke surface over the `RefreshToken` table, scoped to the
 * caller's `userId`. Sessions here are the "logged-in devices"
 * concept — each row is a live refresh-token chain that could rotate
 * new access tokens until it expires or is revoked.
 *
 * Cross-user access is forbidden even for HR / SUPER_ADMIN — sessions
 * are personal and admins revoke via `TokenService.revokeAllForUser`
 * on the user-admin surface (already audited).
 *
 * "Current" session detection is a hash compare against the refresh
 * cookie the caller sent; the raw secret never leaves that request.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List every ACTIVE refresh row for the user, newest-first. Rows
   * whose `expiresAt` has already passed are filtered out — the DB
   * still carries them until a background sweep, but they cannot
   * mint new access tokens so they're not real "sessions" anymore.
   */
  async list(userId: string, currentRawToken?: string): Promise<SessionSummary[]> {
    const currentHash = currentRawToken ? hashRefreshSecret(currentRawToken) : null;

    const rows = await this.prisma.refreshToken.findMany({
      where: {
        userId,
        status: RefreshTokenStatus.ACTIVE,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => this.toSummary(row, currentHash));
  }

  /**
   * Revoke a single session by id. Ownership is enforced — the row
   * MUST belong to the caller. 404 on a stranger row (never leak
   * existence of another user's session id via a different error).
   */
  async revoke(userId: string, sessionId: string): Promise<void> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { id: sessionId },
    });
    if (!row || row.userId !== userId) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'SESSION_NOT_FOUND',
        message: 'Sesi tidak ditemukan.',
      });
    }
    if (row.status !== RefreshTokenStatus.ACTIVE) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'SESSION_ALREADY_REVOKED',
        message: 'Sesi ini sudah tidak aktif.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: row.id },
        data: {
          status: RefreshTokenStatus.REVOKED,
          revokedAt: new Date(),
        },
      });
      await this.writeAudit(tx, {
        userId,
        action: 'SESSION_REVOKED',
        sessionId: row.id,
      });
    });
  }

  /**
   * Revoke every ACTIVE session for the user EXCEPT the caller's own
   * one. Missing `currentRawToken` means "revoke every session" —
   * equivalent to `logout-all`, but audited with the more precise
   * `SESSION_REVOKED_OTHERS` action and reported back with a count
   * so the FE can render a confirmation toast.
   */
  async revokeOthers(userId: string, currentRawToken?: string): Promise<{ revokedCount: number }> {
    const currentHash = currentRawToken ? hashRefreshSecret(currentRawToken) : null;

    const whereClause: Prisma.RefreshTokenWhereInput = {
      userId,
      status: RefreshTokenStatus.ACTIVE,
    };
    if (currentHash) {
      whereClause.tokenHash = { not: currentHash };
    }

    const { count } = await this.prisma.$transaction(async (tx) => {
      const result = await tx.refreshToken.updateMany({
        where: whereClause,
        data: {
          status: RefreshTokenStatus.REVOKED,
          revokedAt: new Date(),
        },
      });
      if (result.count > 0) {
        await this.writeAudit(tx, {
          userId,
          action: 'SESSION_REVOKED_OTHERS',
          count: result.count,
        });
      }
      return result;
    });

    this.logger.warn({
      message: 'revoked other sessions for user',
      userId,
      count,
    });
    return { revokedCount: count };
  }

  private toSummary(row: RefreshToken, currentHash: string | null): SessionSummary {
    return {
      id: row.id,
      userAgent: row.userAgent,
      ip: row.ip,
      mfaVerified: row.mfaVerified,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      isCurrent: currentHash !== null && row.tokenHash === currentHash,
    };
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    args: {
      userId: string;
      action: 'SESSION_REVOKED' | 'SESSION_REVOKED_OTHERS';
      sessionId?: string;
      count?: number;
    },
  ): Promise<void> {
    const user = await tx.user.findUnique({
      where: { id: args.userId },
      select: { companyId: true },
    });
    if (!user) return;
    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        actorId: args.userId,
        action: args.action,
        entityType: 'RefreshToken',
        entityId: args.sessionId ?? args.userId,
        afterJson:
          args.count !== undefined ? ({ count: args.count } as Prisma.InputJsonValue) : undefined,
      },
    });
  }
}
