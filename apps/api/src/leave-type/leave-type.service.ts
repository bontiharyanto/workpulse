import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LeaveType, Prisma } from '@prisma/client';
import { LeaveStatus } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import type { LeaveKindLiteral } from './dto/create-leave-type.dto';
import type { AdminLeaveTypeDto } from './dto/leave-type-response.dto';

export interface CreateLeaveTypeInput {
  code: string;
  name: string;
  kind: LeaveKindLiteral;
  defaultAnnualQuota: number;
  carryOverMax: number;
  requiresAttachment: boolean;
}

export interface UpdateLeaveTypeInput {
  name?: string;
  kind?: LeaveKindLiteral;
  defaultAnnualQuota?: number;
  carryOverMax?: number;
  requiresAttachment?: boolean;
}

type LeaveTypeWithCount = LeaveType & { _count: { balances: number } };

@Injectable()
export class LeaveTypeService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthenticatedUser): Promise<AdminLeaveTypeDto[]> {
    const rows = await this.prisma.leaveType.findMany({
      where: { companyId: actor.companyId, deletedAt: null },
      orderBy: { code: 'asc' },
      include: { _count: { select: { balances: true } } },
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(actor: AuthenticatedUser, id: string): Promise<AdminLeaveTypeDto> {
    return this.toDto(await this.findOwn(actor.companyId, id));
  }

  async create(
    actor: AuthenticatedUser,
    input: CreateLeaveTypeInput,
  ): Promise<AdminLeaveTypeDto> {
    const code = input.code.trim().toUpperCase();
    const year = new Date().getUTCFullYear();

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.leaveType.create({
          data: {
            companyId: actor.companyId,
            code,
            name: input.name.trim(),
            kind: input.kind,
            defaultAnnualQuota: input.defaultAnnualQuota,
            carryOverMax: input.carryOverMax,
            requiresAttachment: input.requiresAttachment,
          },
        });

        // Backfill balances for every ACTIVE user in the tenant for the CURRENT year.
        // Existing years are intentionally NOT backfilled (would be lossy vs. the
        // canonical accrual policy captured on Dec 31 of that year).
        const activeUsers = await tx.user.findMany({
          where: {
            companyId: actor.companyId,
            deletedAt: null,
            employmentStatus: 'ACTIVE',
          },
          select: { id: true },
        });
        if (activeUsers.length > 0) {
          await tx.leaveBalance.createMany({
            data: activeUsers.map((u) => ({
              userId: u.id,
              leaveTypeId: row.id,
              year,
              quota: row.defaultAnnualQuota,
              used: 0,
              reserved: 0,
              carriedOver: 0,
              remaining: row.defaultAnnualQuota,
            })),
            skipDuplicates: true,
          });
        }

        await tx.auditLog.create({
          data: {
            companyId: actor.companyId,
            actorId: actor.id,
            action: 'LEAVE_TYPE_CREATED',
            entityType: 'LeaveType',
            entityId: row.id,
            afterJson: {
              ...(row as unknown as Record<string, unknown>),
              backfilledBalances: activeUsers.length,
            } as unknown as Prisma.InputJsonValue,
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
    input: UpdateLeaveTypeInput,
  ): Promise<AdminLeaveTypeDto> {
    const existing = await this.findOwn(actor.companyId, id);
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.leaveType.update({
        where: { id },
        data: {
          name: input.name?.trim() ?? undefined,
          kind: input.kind ?? undefined,
          defaultAnnualQuota: input.defaultAnnualQuota ?? undefined,
          carryOverMax: input.carryOverMax ?? undefined,
          requiresAttachment: input.requiresAttachment ?? undefined,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'LEAVE_TYPE_UPDATED',
          entityType: 'LeaveType',
          entityId: row.id,
          beforeJson: existing as unknown as Prisma.InputJsonValue,
          afterJson: row as unknown as Prisma.InputJsonValue,
        },
      });
    });
    return this.get(actor, id);
  }

  async remove(actor: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.findOwn(actor.companyId, id);

    const openRequest = await this.prisma.leaveRequest.findFirst({
      where: {
        leaveTypeId: id,
        deletedAt: null,
        status: {
          in: [LeaveStatus.PENDING_SUPERVISOR, LeaveStatus.PENDING_HR, LeaveStatus.APPROVED],
        },
        endDate: { gte: new Date() },
      },
      select: { id: true },
    });
    if (openRequest) {
      throw new ConflictException('LEAVE_TYPE_HAS_OPEN_REQUESTS');
    }

    await this.prisma.$transaction(async (tx) => {
      const row = await tx.leaveType.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'LEAVE_TYPE_DELETED',
          entityType: 'LeaveType',
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

  private async findOwn(companyId: string, id: string): Promise<LeaveTypeWithCount> {
    const row = await this.prisma.leaveType.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { _count: { select: { balances: true } } },
    });
    if (!row) throw new NotFoundException('LEAVE_TYPE_NOT_FOUND');
    return row;
  }

  private mapUniqueConflict(err: unknown): Error {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: unknown }).code === 'P2002'
    ) {
      return new ConflictException('LEAVE_TYPE_CODE_TAKEN');
    }
    return err instanceof Error ? err : new Error('UNKNOWN_ERROR');
  }

  private toDto(row: LeaveTypeWithCount): AdminLeaveTypeDto {
    return {
      id: row.id,
      companyId: row.companyId,
      code: row.code,
      name: row.name,
      kind: row.kind as LeaveKindLiteral,
      defaultAnnualQuota: row.defaultAnnualQuota,
      carryOverMax: row.carryOverMax,
      requiresAttachment: row.requiresAttachment,
      balanceCount: row._count.balances,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
