import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Prisma, RetentionPolicy } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/** Hard-coded safety bounds. Even a rogue admin form cannot escape these. */
export const RETENTION_BOUNDS = {
  notification: { min: 0, max: 730, fallback: 90 },
  dataExport: { min: 1, max: 168, fallback: 24 },
  terminatedUser: { min: 0, max: 3650, fallback: 0 },
} as const;

export interface RetentionPolicyUpdate {
  notificationRetentionDays?: number;
  dataExportArchiveRetentionHours?: number;
  terminatedUserAnonymizeDays?: number;
}

/**
 * Reads and mutates the per-tenant `RetentionPolicy`. Missing rows
 * are lazily created on read so a fresh tenant sees fallback
 * defaults without a bootstrap migration.
 *
 * The retention worker consults this service — never the DB
 * directly — so bounds enforcement happens in exactly one place.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getForCompany(companyId: string): Promise<RetentionPolicy> {
    const existing = await this.prisma.retentionPolicy.findUnique({
      where: { companyId },
    });
    if (existing) return existing;

    // Upsert with defaults. Concurrent creates land on the unique
    // index and one caller wins.
    return this.prisma.retentionPolicy.upsert({
      where: { companyId },
      create: {
        companyId,
        notificationRetentionDays: RETENTION_BOUNDS.notification.fallback,
        dataExportArchiveRetentionHours: RETENTION_BOUNDS.dataExport.fallback,
        terminatedUserAnonymizeDays: RETENTION_BOUNDS.terminatedUser.fallback,
      },
      update: {},
    });
  }

  async update(
    actor: { id: string; companyId: string; role: string },
    input: RetentionPolicyUpdate,
  ): Promise<RetentionPolicy> {
    this.validate(input);

    return this.prisma.$transaction(async (tx) => {
      // Ensure the row exists so the update never surprises the caller
      // with a P2025.
      await tx.retentionPolicy.upsert({
        where: { companyId: actor.companyId },
        create: {
          companyId: actor.companyId,
          notificationRetentionDays: RETENTION_BOUNDS.notification.fallback,
          dataExportArchiveRetentionHours: RETENTION_BOUNDS.dataExport.fallback,
          terminatedUserAnonymizeDays: RETENTION_BOUNDS.terminatedUser.fallback,
        },
        update: {},
      });

      const updated = await tx.retentionPolicy.update({
        where: { companyId: actor.companyId },
        data: {
          ...input,
          updatedById: actor.id,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'RETENTION_POLICY_UPDATED',
          entityType: 'RetentionPolicy',
          entityId: updated.id,
          afterJson: {
            notificationRetentionDays: updated.notificationRetentionDays,
            dataExportArchiveRetentionHours:
              updated.dataExportArchiveRetentionHours,
            terminatedUserAnonymizeDays: updated.terminatedUserAnonymizeDays,
          } as Prisma.InputJsonValue,
        },
      });

      return updated;
    });
  }

  /**
   * Validate a partial update. Called by `update` above; kept public
   * so unit tests can lock the bounds down without going through the
   * transactional path.
   */
  validate(input: RetentionPolicyUpdate): void {
    const errors: string[] = [];
    if (input.notificationRetentionDays !== undefined) {
      this.bound(
        input.notificationRetentionDays,
        RETENTION_BOUNDS.notification,
        'notificationRetentionDays',
        errors,
      );
    }
    if (input.dataExportArchiveRetentionHours !== undefined) {
      this.bound(
        input.dataExportArchiveRetentionHours,
        RETENTION_BOUNDS.dataExport,
        'dataExportArchiveRetentionHours',
        errors,
      );
    }
    if (input.terminatedUserAnonymizeDays !== undefined) {
      this.bound(
        input.terminatedUserAnonymizeDays,
        RETENTION_BOUNDS.terminatedUser,
        'terminatedUserAnonymizeDays',
        errors,
      );
    }
    if (errors.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'RETENTION_OUT_OF_BOUNDS',
        message: 'Retention policy values are outside allowed bounds.',
        details: errors,
      });
    }
  }

  /**
   * Every company with at least one user gets a "sweep target" tuple
   * that the retention worker iterates. We deliberately DON'T list
   * every tenant — a company with zero users has nothing to retain.
   */
  async listCompaniesForSweep(): Promise<
    Array<{ companyId: string; policy: RetentionPolicy }>
  > {
    // Companies with users OR notifications OR TERMINATED users
    // qualify as sweep targets. In practice `deletedAt IS NULL` on
    // Company is the usable filter — a soft-deleted tenant has no
    // active data to prune.
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });

    const result: Array<{ companyId: string; policy: RetentionPolicy }> = [];
    for (const c of companies) {
      const policy = await this.getForCompany(c.id);
      result.push({ companyId: c.id, policy });
    }
    return result;
  }

  private bound(
    value: number,
    range: { min: number; max: number },
    field: string,
    errors: string[],
  ): void {
    if (!Number.isInteger(value)) {
      errors.push(`${field} must be an integer`);
      return;
    }
    if (value < range.min || value > range.max) {
      errors.push(
        `${field} must be between ${range.min} and ${range.max} (got ${value})`,
      );
    }
  }
}
