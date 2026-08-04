import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Shift, UserShiftAssignment } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import { shiftDurationMinutes } from './domain/hh-mm';
import { hasOverlappingAssignment } from './domain/shift-assignment-range';
import type { ShiftTypeLiteral } from './dto/create-shift.dto';
import type { ShiftAssignmentResponseDto, ShiftResponseDto } from './dto/shift-response.dto';

export interface CreateShiftInput {
  name: string;
  type: ShiftTypeLiteral;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  geofenceId?: string | null;
}

export interface UpdateShiftInput {
  name?: string;
  type?: ShiftTypeLiteral;
  startTime?: string;
  endTime?: string;
  graceMinutes?: number;
  geofenceId?: string | null;
}

export interface CreateAssignmentInput {
  userId: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

type ShiftWithGeofence = Shift & {
  geofence: { id: string; name: string } | null;
  _count: {
    assignments: number;
  };
};

type AssignmentWithRelations = UserShiftAssignment & {
  user: { id: string; fullName: string };
  shift: { id: string; name: string };
};

@Injectable()
export class ShiftService {
  constructor(private readonly prisma: PrismaService) {}

  // ==================================================================
  // Shifts
  // ==================================================================

  async list(actor: AuthenticatedUser): Promise<ShiftResponseDto[]> {
    const rows = await this.prisma.shift.findMany({
      where: { companyId: actor.companyId, deletedAt: null },
      orderBy: { name: 'asc' },
      include: {
        geofence: { select: { id: true, name: true } },
        _count: {
          select: {
            assignments: {
              where: {
                deletedAt: null,
                OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
              },
            },
          },
        },
      },
    });
    return rows.map((r) => this.toShiftDto(r));
  }

  async get(actor: AuthenticatedUser, id: string): Promise<ShiftResponseDto> {
    return this.toShiftDto(await this.findOwnShift(actor.companyId, id));
  }

  async create(actor: AuthenticatedUser, input: CreateShiftInput): Promise<ShiftResponseDto> {
    this.assertTimeRange(input.startTime, input.endTime);
    if (input.geofenceId) {
      await this.assertGeofenceInCompany(actor.companyId, input.geofenceId);
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.shift.create({
          data: {
            companyId: actor.companyId,
            name: input.name.trim(),
            type: input.type,
            startTime: input.startTime,
            endTime: input.endTime,
            graceMinutes: input.graceMinutes,
            geofenceId: input.geofenceId ?? null,
          },
        });
        await tx.auditLog.create({
          data: {
            companyId: actor.companyId,
            actorId: actor.id,
            action: 'SHIFT_CREATED',
            entityType: 'Shift',
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
    input: UpdateShiftInput,
  ): Promise<ShiftResponseDto> {
    const existing = await this.findOwnShift(actor.companyId, id);

    const nextStart = input.startTime ?? existing.startTime;
    const nextEnd = input.endTime ?? existing.endTime;
    if (input.startTime !== undefined || input.endTime !== undefined) {
      this.assertTimeRange(nextStart, nextEnd);
    }
    if (input.geofenceId) {
      await this.assertGeofenceInCompany(actor.companyId, input.geofenceId);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const row = await tx.shift.update({
          where: { id },
          data: {
            name: input.name?.trim() ?? undefined,
            type: input.type ?? undefined,
            startTime: input.startTime ?? undefined,
            endTime: input.endTime ?? undefined,
            graceMinutes: input.graceMinutes ?? undefined,
            geofenceId: input.geofenceId === undefined ? undefined : input.geofenceId,
          },
        });
        await tx.auditLog.create({
          data: {
            companyId: actor.companyId,
            actorId: actor.id,
            action: 'SHIFT_UPDATED',
            entityType: 'Shift',
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
    const existing = await this.findOwnShift(actor.companyId, id);
    if (existing._count.assignments > 0) {
      throw new ConflictException('SHIFT_HAS_ACTIVE_ASSIGNMENTS');
    }
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.shift.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'SHIFT_DELETED',
          entityType: 'Shift',
          entityId: row.id,
          beforeJson: existing as unknown as Prisma.InputJsonValue,
          afterJson: row as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }

  // ==================================================================
  // Assignments
  // ==================================================================

  async listAssignmentsForUser(
    actor: AuthenticatedUser,
    userId: string,
  ): Promise<ShiftAssignmentResponseDto[]> {
    await this.assertUserInCompany(actor.companyId, userId);
    const rows = await this.prisma.userShiftAssignment.findMany({
      where: { userId, deletedAt: null },
      orderBy: { effectiveFrom: 'desc' },
      include: {
        user: { select: { id: true, fullName: true } },
        shift: { select: { id: true, name: true } },
      },
    });
    return rows.map((r) => this.toAssignmentDto(r));
  }

  async createAssignment(
    actor: AuthenticatedUser,
    shiftId: string,
    input: CreateAssignmentInput,
  ): Promise<ShiftAssignmentResponseDto> {
    await this.findOwnShift(actor.companyId, shiftId);
    await this.assertUserInCompany(actor.companyId, input.userId);

    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
      throw new BadRequestException('ASSIGNMENT_INVALID_RANGE');
    }

    const existing = await this.prisma.userShiftAssignment.findMany({
      where: { userId: input.userId, deletedAt: null },
      select: { id: true, effectiveFrom: true, effectiveTo: true },
    });

    const overlap = hasOverlappingAssignment(
      {
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
      },
      existing.map((r) => ({
        id: r.id,
        effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: r.effectiveTo ? r.effectiveTo.toISOString().slice(0, 10) : null,
      })),
    );
    if (overlap) throw new ConflictException('ASSIGNMENT_OVERLAP');

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.userShiftAssignment.create({
        data: {
          userId: input.userId,
          shiftId,
          effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00.000Z`),
          effectiveTo: input.effectiveTo ? new Date(`${input.effectiveTo}T00:00:00.000Z`) : null,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'SHIFT_ASSIGNMENT_CREATED',
          entityType: 'UserShiftAssignment',
          entityId: row.id,
          afterJson: row as unknown as Prisma.InputJsonValue,
        },
      });
      return row;
    });

    const withRelations = await this.prisma.userShiftAssignment.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        user: { select: { id: true, fullName: true } },
        shift: { select: { id: true, name: true } },
      },
    });
    return this.toAssignmentDto(withRelations);
  }

  async endAssignment(
    actor: AuthenticatedUser,
    id: string,
    effectiveTo: string,
  ): Promise<ShiftAssignmentResponseDto> {
    const existing = await this.findOwnAssignment(actor.companyId, id);
    const fromStr = existing.effectiveFrom.toISOString().slice(0, 10);
    if (effectiveTo < fromStr) {
      throw new BadRequestException('ASSIGNMENT_INVALID_RANGE');
    }

    await this.prisma.$transaction(async (tx) => {
      const row = await tx.userShiftAssignment.update({
        where: { id },
        data: { effectiveTo: new Date(`${effectiveTo}T00:00:00.000Z`) },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'SHIFT_ASSIGNMENT_ENDED',
          entityType: 'UserShiftAssignment',
          entityId: row.id,
          beforeJson: existing as unknown as Prisma.InputJsonValue,
          afterJson: row as unknown as Prisma.InputJsonValue,
        },
      });
    });

    const withRelations = await this.prisma.userShiftAssignment.findUniqueOrThrow({
      where: { id },
      include: {
        user: { select: { id: true, fullName: true } },
        shift: { select: { id: true, name: true } },
      },
    });
    return this.toAssignmentDto(withRelations);
  }

  async removeAssignment(actor: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.findOwnAssignment(actor.companyId, id);
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    if (existing.effectiveFrom <= startOfToday) {
      throw new ConflictException('ASSIGNMENT_ALREADY_STARTED_USE_END');
    }
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.userShiftAssignment.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'SHIFT_ASSIGNMENT_REMOVED',
          entityType: 'UserShiftAssignment',
          entityId: row.id,
          beforeJson: existing as unknown as Prisma.InputJsonValue,
          afterJson: row as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }

  // ==================================================================
  // Internals
  // ==================================================================

  private assertTimeRange(startTime: string, endTime: string): void {
    try {
      shiftDurationMinutes(startTime, endTime);
    } catch {
      throw new BadRequestException('SHIFT_TIMES_INVALID');
    }
  }

  private async assertGeofenceInCompany(companyId: string, geofenceId: string): Promise<void> {
    const row = await this.prisma.geofence.findFirst({
      where: { id: geofenceId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!row) throw new BadRequestException('GEOFENCE_INVALID');
  }

  private async assertUserInCompany(companyId: string, userId: string): Promise<void> {
    const row = await this.prisma.user.findFirst({
      where: { id: userId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!row) throw new BadRequestException('USER_INVALID');
  }

  private async findOwnShift(companyId: string, id: string): Promise<ShiftWithGeofence> {
    const row = await this.prisma.shift.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        geofence: { select: { id: true, name: true } },
        _count: {
          select: {
            assignments: {
              where: {
                deletedAt: null,
                OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
              },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('SHIFT_NOT_FOUND');
    return row;
  }

  private async findOwnAssignment(
    companyId: string,
    id: string,
  ): Promise<UserShiftAssignment & { shift: { companyId: string } }> {
    const row = await this.prisma.userShiftAssignment.findFirst({
      where: { id, deletedAt: null, shift: { companyId } },
      include: { shift: { select: { companyId: true } } },
    });
    if (!row) throw new NotFoundException('ASSIGNMENT_NOT_FOUND');
    return row;
  }

  private mapUniqueConflict(err: unknown): Error {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: unknown }).code === 'P2002'
    ) {
      return new ConflictException('SHIFT_NAME_TAKEN');
    }
    return err instanceof Error ? err : new Error('UNKNOWN_ERROR');
  }

  private toShiftDto(row: ShiftWithGeofence): ShiftResponseDto {
    return {
      id: row.id,
      companyId: row.companyId,
      name: row.name,
      type: row.type as ShiftTypeLiteral,
      startTime: row.startTime,
      endTime: row.endTime,
      graceMinutes: row.graceMinutes,
      geofenceId: row.geofenceId,
      geofenceName: row.geofence?.name ?? null,
      activeAssignments: row._count.assignments,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toAssignmentDto(row: AssignmentWithRelations): ShiftAssignmentResponseDto {
    const now = new Date();
    const active = row.effectiveFrom <= now && (row.effectiveTo === null || row.effectiveTo > now);
    return {
      id: row.id,
      userId: row.userId,
      userFullName: row.user.fullName,
      shiftId: row.shiftId,
      shiftName: row.shift.name,
      effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString().slice(0, 10) : null,
      active,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
