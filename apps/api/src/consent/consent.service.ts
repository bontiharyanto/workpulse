import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  Prisma,
  PrivacyPolicy,
  UserConsent,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Privacy-policy + user-consent service (Fase 31c).
 *
 * Contract with the FE:
 *
 *   * `getLatestForCompany(companyId)` returns the currently
 *     applicable policy (largest `effectiveAt <= NOW()`). Newer
 *     policies with a future `effectiveAt` do NOT surface until
 *     that timestamp elapses.
 *   * `getPendingConsentForUser(userId, companyId)` returns the
 *     latest policy iff the user has NOT accepted it yet. That
 *     value is what the login flow hands the FE as
 *     `pendingConsent`.
 *   * `accept()` writes an append-only `UserConsent` row. The
 *     unique index on `(userId, policyId)` guarantees a second
 *     accept for the same policy is a no-op (409, so the FE knows
 *     not to bother polling).
 */
@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async getLatestForCompany(companyId: string): Promise<PrivacyPolicy | null> {
    return this.prisma.privacyPolicy.findFirst({
      where: {
        companyId,
        effectiveAt: { lte: new Date() },
      },
      orderBy: { effectiveAt: 'desc' },
    });
  }

  async listForCompany(companyId: string): Promise<PrivacyPolicy[]> {
    return this.prisma.privacyPolicy.findMany({
      where: { companyId },
      orderBy: { effectiveAt: 'desc' },
      take: 50,
    });
  }

  async getPendingConsentForUser(
    userId: string,
    companyId: string,
  ): Promise<PrivacyPolicy | null> {
    const latest = await this.getLatestForCompany(companyId);
    if (!latest) return null;
    const accepted = await this.prisma.userConsent.findUnique({
      where: {
        userId_policyId: { userId, policyId: latest.id },
      },
      select: { id: true },
    });
    if (accepted) return null;
    return latest;
  }

  async listUserConsents(userId: string): Promise<
    Array<UserConsent & { policy: PrivacyPolicy }>
  > {
    return this.prisma.userConsent.findMany({
      where: { userId },
      orderBy: { acceptedAt: 'desc' },
      include: { policy: true },
      take: 50,
    });
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  async accept(
    userId: string,
    companyId: string,
    policyId: string,
    context: { ip?: string | null; userAgent?: string | null } = {},
  ): Promise<UserConsent> {
    const policy = await this.prisma.privacyPolicy.findUnique({
      where: { id: policyId },
    });
    if (!policy || policy.companyId !== companyId) {
      // Cross-tenant policy id or missing row — collapse to 404 so
      // one tenant cannot enumerate the other's policy IDs.
      throw new NotFoundException({
        statusCode: 404,
        code: 'POLICY_NOT_FOUND',
        message: 'Kebijakan privasi tidak ditemukan.',
      });
    }
    if (policy.effectiveAt > new Date()) {
      throw new ConflictException({
        statusCode: 409,
        code: 'POLICY_NOT_YET_EFFECTIVE',
        message: 'Kebijakan ini belum berlaku.',
      });
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.userConsent.create({
          data: {
            userId,
            policyId,
            companyId,
            ip: context.ip ?? null,
            userAgent: context.userAgent?.slice(0, 500) ?? null,
          },
        });
        await tx.auditLog.create({
          data: {
            companyId,
            actorId: userId,
            action: 'CONSENT_ACCEPTED',
            entityType: 'PrivacyPolicy',
            entityId: policyId,
            afterJson: {
              version: policy.version,
            } as Prisma.InputJsonValue,
          },
        });
        return row;
      });
    } catch (err) {
      // Uniqueness violation → the user already accepted. Return 409
      // so the FE can transparently move on.
      if (
        (err as { code?: string }).code === 'P2002' ||
        (err as { name?: string }).name === 'PrismaClientKnownRequestError'
      ) {
        const message = (err as Error).message;
        if (message.includes('UserConsent_userId_policyId')) {
          throw new ConflictException({
            statusCode: 409,
            code: 'CONSENT_ALREADY_ACCEPTED',
            message: 'Anda sudah menerima kebijakan ini.',
          });
        }
      }
      throw err;
    }
  }

  async publish(
    actor: { id: string; companyId: string; role: string },
    input: {
      version: string;
      title: string;
      body: string;
      effectiveAt?: Date;
    },
  ): Promise<PrivacyPolicy> {
    const effectiveAt = input.effectiveAt ?? new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.privacyPolicy.create({
          data: {
            companyId: actor.companyId,
            version: input.version.trim(),
            title: input.title.trim(),
            body: input.body,
            effectiveAt,
            publishedById: actor.id,
          },
        });
        await tx.auditLog.create({
          data: {
            companyId: actor.companyId,
            actorId: actor.id,
            action: 'POLICY_PUBLISHED',
            entityType: 'PrivacyPolicy',
            entityId: row.id,
            afterJson: {
              version: row.version,
              effectiveAt: row.effectiveAt.toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
        return row;
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException({
          statusCode: 409,
          code: 'POLICY_VERSION_DUPLICATE',
          message: `Versi "${input.version}" sudah ada.`,
        });
      }
      throw err;
    }
  }
}
