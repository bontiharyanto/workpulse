import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  CustomReportDefinition,
  InvalidReportDefinitionError,
  validateDefinition,
} from './domain/custom-report-definition';

interface CreateInput {
  name: string;
  description?: string;
  definition: unknown;
}

interface UpdateInput {
  name?: string;
  description?: string | null;
  definition?: unknown;
}

/**
 * Fase 33b — CRUD for `SavedReport`. Every write re-validates the
 * definition blob through the domain module — the DB will happily
 * store anything JSON-shaped, but the executor refuses to run
 * unvalidated recipes so we double-check at persist-time.
 */
@Injectable()
export class SavedReportService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthenticatedUser) {
    return this.prisma.savedReport.findMany({
      where: { companyId: actor.companyId },
      orderBy: [{ updatedAt: 'desc' }],
    });
  }

  async detail(actor: AuthenticatedUser, id: string) {
    const row = await this.prisma.savedReport.findFirst({
      where: { id, companyId: actor.companyId },
    });
    if (!row) throw new NotFoundException('SAVED_REPORT_NOT_FOUND');
    return row;
  }

  async definitionFor(actor: AuthenticatedUser, id: string): Promise<CustomReportDefinition> {
    const row = await this.detail(actor, id);
    return validateDefinition(row.definition);
  }

  async create(actor: AuthenticatedUser, input: CreateInput) {
    const def = this.validateOrThrow(input.definition);
    return this.prisma.$transaction(async (tx) => {
      const dup = await tx.savedReport.findFirst({
        where: { companyId: actor.companyId, name: input.name.trim() },
        select: { id: true },
      });
      if (dup) throw new ConflictException('SAVED_REPORT_NAME_TAKEN');
      const created = await tx.savedReport.create({
        data: {
          companyId: actor.companyId,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          definition: def as unknown as Prisma.InputJsonValue,
          createdById: actor.id,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'SAVED_REPORT_CREATED',
          entityType: 'SavedReport',
          entityId: created.id,
          afterJson: {
            name: created.name,
            dimension: def.dimension,
            metric: def.metric,
          } as Prisma.InputJsonValue,
        },
      });
      return created;
    });
  }

  async update(actor: AuthenticatedUser, id: string, input: UpdateInput) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.savedReport.findFirst({
        where: { id, companyId: actor.companyId },
      });
      if (!current) throw new NotFoundException('SAVED_REPORT_NOT_FOUND');
      const patch: Prisma.SavedReportUncheckedUpdateInput = {};
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.description !== undefined) {
        patch.description = input.description?.trim() || null;
      }
      if (input.definition !== undefined) {
        const def = this.validateOrThrow(input.definition);
        patch.definition = def as unknown as Prisma.InputJsonValue;
      }
      const updated = await tx.savedReport.update({
        where: { id },
        data: patch,
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'SAVED_REPORT_UPDATED',
          entityType: 'SavedReport',
          entityId: id,
          afterJson: { fields: Object.keys(patch) } as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
  }

  async remove(actor: AuthenticatedUser, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.savedReport.findFirst({
        where: { id, companyId: actor.companyId },
      });
      if (!current) throw new NotFoundException('SAVED_REPORT_NOT_FOUND');
      await tx.savedReport.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'SAVED_REPORT_DELETED',
          entityType: 'SavedReport',
          entityId: id,
          beforeJson: {
            name: current.name,
          } as Prisma.InputJsonValue,
        },
      });
    });
  }

  private validateOrThrow(raw: unknown): CustomReportDefinition {
    try {
      return validateDefinition(raw);
    } catch (err) {
      if (err instanceof InvalidReportDefinitionError) {
        throw new BadRequestException(err.message);
      }
      throw err as Error;
    }
  }
}
