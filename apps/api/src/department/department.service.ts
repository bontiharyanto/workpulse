import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Department, Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import type { DepartmentResponseDto } from './dto/department-response.dto';

export interface CreateDepartmentInput {
  name: string;
  parentId?: string | null;
}

export interface UpdateDepartmentInput {
  name?: string;
  parentId?: string | null;
}

@Injectable()
export class DepartmentService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthenticatedUser): Promise<DepartmentResponseDto[]> {
    const rows = await this.prisma.department.findMany({
      where: { companyId: actor.companyId, deletedAt: null },
      orderBy: { name: 'asc' },
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { users: { where: { deletedAt: null } } } },
      },
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(actor: AuthenticatedUser, id: string): Promise<DepartmentResponseDto> {
    const row = await this.prisma.department.findFirst({
      where: { id, companyId: actor.companyId, deletedAt: null },
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { users: { where: { deletedAt: null } } } },
      },
    });
    if (!row) throw new NotFoundException('DEPARTMENT_NOT_FOUND');
    return this.toDto(row);
  }

  async create(
    actor: AuthenticatedUser,
    input: CreateDepartmentInput,
  ): Promise<DepartmentResponseDto> {
    const trimmed = input.name.trim();
    await this.assertParentInCompany(actor.companyId, input.parentId ?? null);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.department.create({
          data: {
            companyId: actor.companyId,
            name: trimmed,
            parentId: input.parentId ?? null,
          },
        });
        await tx.auditLog.create({
          data: {
            companyId: actor.companyId,
            actorId: actor.id,
            action: 'DEPARTMENT_CREATED',
            entityType: 'Department',
            entityId: row.id,
            afterJson: row as unknown as Prisma.InputJsonValue,
          },
        });
        return row;
      });
      return this.get(actor, created.id);
    } catch (err) {
      throw this.mapUniqueConflict(err);
    }
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateDepartmentInput,
  ): Promise<DepartmentResponseDto> {
    const existing = await this.prisma.department.findFirst({
      where: { id, companyId: actor.companyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('DEPARTMENT_NOT_FOUND');

    if (input.parentId !== undefined) {
      if (input.parentId === id) {
        throw new BadRequestException('DEPARTMENT_PARENT_CANNOT_BE_SELF');
      }
      if (input.parentId) {
        await this.assertParentInCompany(actor.companyId, input.parentId);
        await this.assertNoCycle(actor.companyId, id, input.parentId);
      }
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const row = await tx.department.update({
          where: { id },
          data: {
            name: input.name?.trim() ?? undefined,
            parentId: input.parentId === undefined ? undefined : input.parentId,
          },
        });
        await tx.auditLog.create({
          data: {
            companyId: actor.companyId,
            actorId: actor.id,
            action: 'DEPARTMENT_UPDATED',
            entityType: 'Department',
            entityId: row.id,
            beforeJson: existing as unknown as Prisma.InputJsonValue,
            afterJson: row as unknown as Prisma.InputJsonValue,
          },
        });
      });
      return this.get(actor, id);
    } catch (err) {
      throw this.mapUniqueConflict(err);
    }
  }

  async remove(actor: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.prisma.department.findFirst({
      where: { id, companyId: actor.companyId, deletedAt: null },
      include: {
        _count: {
          select: {
            users: { where: { deletedAt: null } },
            children: { where: { deletedAt: null } },
          },
        },
      },
    });
    if (!existing) throw new NotFoundException('DEPARTMENT_NOT_FOUND');
    if (existing._count.users > 0) {
      throw new ConflictException('DEPARTMENT_HAS_ACTIVE_USERS');
    }
    if (existing._count.children > 0) {
      throw new ConflictException('DEPARTMENT_HAS_CHILDREN');
    }

    await this.prisma.$transaction(async (tx) => {
      const row = await tx.department.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'DEPARTMENT_DELETED',
          entityType: 'Department',
          entityId: row.id,
          beforeJson: existing as unknown as Prisma.InputJsonValue,
          afterJson: row as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async assertParentInCompany(
    companyId: string,
    parentId: string | null,
  ): Promise<void> {
    if (!parentId) return;
    const parent = await this.prisma.department.findFirst({
      where: { id: parentId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!parent) throw new BadRequestException('DEPARTMENT_PARENT_INVALID');
  }

  /** Walk parent chain to ensure moving `childId` under `newParentId` doesn't create a cycle. */
  private async assertNoCycle(
    companyId: string,
    childId: string,
    newParentId: string,
  ): Promise<void> {
    let cursor: string | null = newParentId;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === childId) {
        throw new BadRequestException('DEPARTMENT_CYCLE_DETECTED');
      }
      if (visited.has(cursor)) return;
      visited.add(cursor);
      const row: { parentId: string | null } | null = await this.prisma.department.findFirst({
        where: { id: cursor, companyId, deletedAt: null },
        select: { parentId: true },
      });
      cursor = row?.parentId ?? null;
    }
  }

  private mapUniqueConflict(err: unknown): Error {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: unknown }).code === 'P2002'
    ) {
      return new ConflictException('DEPARTMENT_NAME_TAKEN');
    }
    return err instanceof Error ? err : new Error('UNKNOWN_ERROR');
  }

  private toDto(
    row: Department & {
      parent: { id: string; name: string } | null;
      _count: { users: number };
    },
  ): DepartmentResponseDto {
    return {
      id: row.id,
      companyId: row.companyId,
      name: row.name,
      parentId: row.parentId,
      parentName: row.parent?.name ?? null,
      userCount: row._count.users,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
