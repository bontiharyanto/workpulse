import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LeaveType, Prisma, User } from '@prisma/client';
import { EmploymentStatus } from '@prisma/client';

import { PasswordService } from '../auth/password.service';
import { TokenService } from '../auth/token.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import type { UserRole } from '../common/types/user-role';
import { PrismaService } from '../prisma/prisma.service';
import { canAssignRole, canManageUser } from './domain/role-hierarchy';
import { generateTempPassword } from './domain/temp-password';
import type { AdminUserDto, UserCredentialResponseDto } from './dto/user-response.dto';

export interface CreateUserInput {
  email: string;
  fullName: string;
  role: UserRole;
  departmentId?: string | null;
  supervisorId?: string | null;
  hiredAt: string;
}

export interface UpdateUserInput {
  fullName?: string;
  role?: UserRole;
  departmentId?: string | null;
  supervisorId?: string | null;
  employmentStatus?: EmploymentStatus;
}

export interface ListUsersFilter {
  search?: string;
  role?: UserRole;
  departmentId?: string;
  status?: EmploymentStatus;
  includeInactive?: boolean;
}

type UserWithRelations = User & {
  department: { id: string; name: string } | null;
  supervisor: { id: string; fullName: string } | null;
};

@Injectable()
export class UserAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  // ==================================================================
  // Queries
  // ==================================================================

  async list(actor: AuthenticatedUser, filter: ListUsersFilter): Promise<AdminUserDto[]> {
    const where: Prisma.UserWhereInput = {
      companyId: actor.companyId,
      ...(filter.includeInactive ? {} : { deletedAt: null }),
      ...(filter.role ? { role: filter.role } : {}),
      ...(filter.status ? { employmentStatus: filter.status } : {}),
      ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
    };
    if (filter.search) {
      const q = filter.search.trim();
      where.OR = [
        { email: { contains: q, mode: 'insensitive' } },
        { fullName: { contains: q, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.user.findMany({
      where,
      orderBy: [{ deletedAt: 'asc' }, { fullName: 'asc' }],
      include: {
        department: { select: { id: true, name: true } },
        supervisor: { select: { id: true, fullName: true } },
      },
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(actor: AuthenticatedUser, id: string): Promise<AdminUserDto> {
    const row = await this.findOneInCompany(actor.companyId, id, /* includeDeleted */ true);
    return this.toDto(row);
  }

  // ==================================================================
  // Create
  // ==================================================================

  async create(
    actor: AuthenticatedUser,
    input: CreateUserInput,
  ): Promise<UserCredentialResponseDto> {
    if (!canAssignRole(actor.role, input.role)) {
      throw new ForbiddenException('ROLE_ASSIGNMENT_FORBIDDEN');
    }

    const normalizedEmail = input.email.trim().toLowerCase();

    if (input.departmentId) {
      await this.assertDepartmentInCompany(actor.companyId, input.departmentId);
    }
    if (input.supervisorId) {
      await this.assertSupervisorInCompany(actor.companyId, input.supervisorId);
    }

    const temporaryPassword = generateTempPassword(14);
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const activeLeaveTypes = await this.prisma.leaveType.findMany({
      where: { companyId: actor.companyId, deletedAt: null },
    });

    const currentYear = new Date().getUTCFullYear();

    let created: User;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            companyId: actor.companyId,
            email: normalizedEmail,
            fullName: input.fullName.trim(),
            role: input.role,
            employmentStatus: EmploymentStatus.ACTIVE,
            departmentId: input.departmentId ?? null,
            supervisorId: input.supervisorId ?? null,
            hiredAt: new Date(`${input.hiredAt}T00:00:00.000Z`),
            passwordHash,
            // Admin-issued temp password → force self-service rotation on
            // first login. Cleared by AuthService.changePassword or by the
            // email-based reset flow.
            mustChangePassword: true,
          },
        });

        if (activeLeaveTypes.length > 0) {
          await this.seedLeaveBalances(tx, user.id, currentYear, activeLeaveTypes);
        }

        await tx.auditLog.create({
          data: {
            companyId: actor.companyId,
            actorId: actor.id,
            action: 'USER_CREATED',
            entityType: 'User',
            entityId: user.id,
            // NEVER persist the temp password or hash in audit trail
            afterJson: this.stripSensitive(user) as unknown as Prisma.InputJsonValue,
          },
        });

        return user;
      });
    } catch (err) {
      throw this.mapUniqueConflict(err);
    }

    const dto = await this.get(actor, created.id);
    return { user: dto, temporaryPassword };
  }

  // ==================================================================
  // Update
  // ==================================================================

  async update(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateUserInput,
  ): Promise<AdminUserDto> {
    const existing = await this.findOneInCompany(actor.companyId, id, /* includeDeleted */ true);
    this.assertCanManage(actor, existing);

    if (input.role !== undefined) {
      if (!canAssignRole(actor.role, input.role)) {
        throw new ForbiddenException('ROLE_ASSIGNMENT_FORBIDDEN');
      }
      if (existing.id === actor.id && input.role !== existing.role) {
        throw new ForbiddenException('SELF_ROLE_CHANGE_FORBIDDEN');
      }
    }

    if (input.employmentStatus !== undefined && existing.id === actor.id) {
      if (input.employmentStatus !== EmploymentStatus.ACTIVE) {
        throw new ForbiddenException('SELF_STATUS_CHANGE_FORBIDDEN');
      }
    }

    if (input.departmentId) {
      await this.assertDepartmentInCompany(actor.companyId, input.departmentId);
    }
    if (input.supervisorId) {
      if (input.supervisorId === id) {
        throw new BadRequestException('SUPERVISOR_CANNOT_BE_SELF');
      }
      await this.assertSupervisorInCompany(actor.companyId, input.supervisorId);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id },
          data: {
            fullName: input.fullName?.trim() ?? undefined,
            role: input.role ?? undefined,
            departmentId: input.departmentId === undefined ? undefined : input.departmentId,
            supervisorId: input.supervisorId === undefined ? undefined : input.supervisorId,
            employmentStatus: input.employmentStatus ?? undefined,
          },
        });
        await tx.auditLog.create({
          data: {
            companyId: actor.companyId,
            actorId: actor.id,
            action: 'USER_UPDATED',
            entityType: 'User',
            entityId: updated.id,
            beforeJson: this.stripSensitive(existing) as unknown as Prisma.InputJsonValue,
            afterJson: this.stripSensitive(updated) as unknown as Prisma.InputJsonValue,
          },
        });
      });
    } catch (err) {
      throw this.mapUniqueConflict(err);
    }

    return this.get(actor, id);
  }

  // ==================================================================
  // Deactivate (soft delete + revoke refresh tokens)
  // ==================================================================

  async deactivate(actor: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.findOneInCompany(actor.companyId, id, /* includeDeleted */ false);
    this.assertCanManage(actor, existing);
    if (existing.id === actor.id) {
      throw new ForbiddenException('SELF_DEACTIVATE_FORBIDDEN');
    }

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          employmentStatus: EmploymentStatus.TERMINATED,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'USER_DEACTIVATED',
          entityType: 'User',
          entityId: updated.id,
          beforeJson: this.stripSensitive(existing) as unknown as Prisma.InputJsonValue,
          afterJson: this.stripSensitive(updated) as unknown as Prisma.InputJsonValue,
        },
      });
    });

    await this.tokens.revokeAllForUser(id, 'USER_DEACTIVATED');
  }

  // ==================================================================
  // Reset password (admin-issued temporary password)
  // ==================================================================

  async resetPassword(actor: AuthenticatedUser, id: string): Promise<UserCredentialResponseDto> {
    const existing = await this.findOneInCompany(actor.companyId, id, /* includeDeleted */ false);
    this.assertCanManage(actor, existing);

    const temporaryPassword = generateTempPassword(14);
    const passwordHash = await this.passwords.hash(temporaryPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        // Any admin-issued reset re-arms the enforcement flag so the target
        // is bounced through /change-password on their next login, even if
        // they had previously rotated to a self-picked password.
        data: { passwordHash, mustChangePassword: true },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'PASSWORD_RESET_BY_ADMIN',
          entityType: 'User',
          entityId: id,
        },
      });
    });

    await this.tokens.revokeAllForUser(id, 'PASSWORD_RESET_BY_ADMIN');
    const dto = await this.get(actor, id);
    return { user: dto, temporaryPassword };
  }

  // ==================================================================
  // Internals
  // ==================================================================

  private assertCanManage(actor: AuthenticatedUser, target: User): void {
    if (!canManageUser(actor.role, target.role as UserRole)) {
      throw new ForbiddenException('CANNOT_MANAGE_HIGHER_ROLE');
    }
  }

  private async findOneInCompany(
    companyId: string,
    id: string,
    includeDeleted: boolean,
  ): Promise<UserWithRelations> {
    const row = await this.prisma.user.findFirst({
      where: {
        id,
        companyId,
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
      include: {
        department: { select: { id: true, name: true } },
        supervisor: { select: { id: true, fullName: true } },
      },
    });
    if (!row) throw new NotFoundException('USER_NOT_FOUND');
    return row;
  }

  private async assertDepartmentInCompany(companyId: string, departmentId: string): Promise<void> {
    const row = await this.prisma.department.findFirst({
      where: { id: departmentId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!row) throw new BadRequestException('DEPARTMENT_INVALID');
  }

  private async assertSupervisorInCompany(companyId: string, supervisorId: string): Promise<void> {
    const row = await this.prisma.user.findFirst({
      where: { id: supervisorId, companyId, deletedAt: null },
      select: { role: true },
    });
    if (!row) throw new BadRequestException('SUPERVISOR_INVALID');
    if (row.role === 'EMPLOYEE') {
      throw new BadRequestException('SUPERVISOR_MUST_HAVE_LEAD_ROLE');
    }
  }

  private async seedLeaveBalances(
    tx: Prisma.TransactionClient,
    userId: string,
    year: number,
    types: LeaveType[],
  ): Promise<void> {
    await tx.leaveBalance.createMany({
      data: types.map((t) => ({
        userId,
        leaveTypeId: t.id,
        year,
        quota: t.defaultAnnualQuota,
        used: 0,
        reserved: 0,
        carriedOver: 0,
        remaining: t.defaultAnnualQuota,
      })),
      skipDuplicates: true,
    });
  }

  private mapUniqueConflict(err: unknown): Error {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: unknown }).code === 'P2002'
    ) {
      return new ConflictException('EMAIL_ALREADY_TAKEN');
    }
    return err instanceof Error ? err : new Error('UNKNOWN_ERROR');
  }

  /** Never leak password hash or refresh-token relations in audit or DTO. */
  private stripSensitive<T extends { passwordHash?: string }>(row: T): Omit<T, 'passwordHash'> {
    const { passwordHash: _pw, ...rest } = row;
    return rest;
  }

  private toDto(row: UserWithRelations): AdminUserDto {
    return {
      id: row.id,
      companyId: row.companyId,
      email: row.email,
      fullName: row.fullName,
      role: row.role as UserRole,
      employmentStatus: row.employmentStatus,
      departmentId: row.departmentId,
      departmentName: row.department?.name ?? null,
      supervisorId: row.supervisorId,
      supervisorName: row.supervisor?.fullName ?? null,
      hiredAt: row.hiredAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deactivatedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    };
  }
}
