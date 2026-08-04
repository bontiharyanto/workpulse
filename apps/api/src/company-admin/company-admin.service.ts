import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Company, LeaveType, Prisma } from '@prisma/client';
import { EmploymentStatus, LeaveKind } from '@prisma/client';

import { PasswordService } from '../auth/password.service';
import { derivateSlug, isValidSlug, uniqueSlug } from './domain/slug';
import type { CompanyAdminDto, CompanyBootstrapDto } from './dto/company-admin.dto';
import type { CreateCompanyDto } from './dto/create-company.dto';
import type { ListCompaniesResponseDto } from './dto/list-companies-response.dto';
import type { ListCompaniesQuery } from './dto/list-companies.query';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { InvalidTimezoneError, assertValidTimezone } from '../company/domain/timezone';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateCompanyDto } from './dto/update-company.dto';
import { generateTempPassword } from '../user/domain/temp-password';


/**
 * Default LeaveType templates seeded on tenant creation. Keeps a new tenant
 * usable end-to-end without a follow-up config API call. Quotas are safe
 * defaults; HR can adjust them via `/admin/leave-types` afterwards.
 */
const DEFAULT_LEAVE_TYPES: ReadonlyArray<{
  code: string;
  name: string;
  kind: LeaveKind;
  defaultAnnualQuota: number;
  carryOverMax: number;
  requiresAttachment: boolean;
}> = [
  {
    code: 'ANNUAL',
    name: 'Annual Leave',
    kind: LeaveKind.ANNUAL,
    defaultAnnualQuota: 12,
    carryOverMax: 5,
    requiresAttachment: false,
  },
  {
    code: 'SICK',
    name: 'Sick Leave',
    kind: LeaveKind.SICK,
    defaultAnnualQuota: 14,
    carryOverMax: 0,
    requiresAttachment: true,
  },
  {
    code: 'PERSONAL',
    name: 'Personal Leave',
    kind: LeaveKind.PERSONAL,
    defaultAnnualQuota: 3,
    carryOverMax: 0,
    requiresAttachment: false,
  },
];

type CompanyWithCounts = Company & {
  _count: { users: number; departments: number };
};

@Injectable()
export class CompanyAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  // ==================================================================
  // Queries
  // ==================================================================

  async list(
    actor: AuthenticatedUser,
    filter: ListCompaniesQuery,
  ): Promise<ListCompaniesResponseDto> {
    this.assertSuperAdmin(actor);

    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));
    const includeDeleted = filter.includeDeleted === true;

    const where: Prisma.CompanyWhereInput = {
      ...(includeDeleted ? {} : { deletedAt: null }),
    };
    if (filter.search && filter.search.trim().length > 0) {
      const q = filter.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.company.findMany({
        where,
        orderBy: [{ deletedAt: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: {
            select: {
              users: { where: { deletedAt: null } },
              departments: { where: { deletedAt: null } },
            },
          },
        },
      }),
      this.prisma.company.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.toDto(r)),
      totalCount,
      page,
      pageSize,
    };
  }

  async get(actor: AuthenticatedUser, id: string): Promise<CompanyAdminDto> {
    this.assertSuperAdmin(actor);
    const row = await this.prisma.company.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            users: { where: { deletedAt: null } },
            departments: { where: { deletedAt: null } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('COMPANY_NOT_FOUND');
    return this.toDto(row);
  }

  // ==================================================================
  // Create
  // ==================================================================

  async create(actor: AuthenticatedUser, input: CreateCompanyDto): Promise<CompanyBootstrapDto> {
    this.assertSuperAdmin(actor);

    const name = input.name.trim();
    const hrEmail = input.hrEmail.trim().toLowerCase();
    const hrFullName = input.hrFullName.trim();
    const timezone = (input.timezone ?? 'Asia/Jakarta').trim();

    try {
      assertValidTimezone(timezone);
    } catch (e) {
      if (e instanceof InvalidTimezoneError) {
        throw new BadRequestException({ code: e.code, message: e.message });
      }
      throw e;
    }

    // Resolve slug BEFORE the transaction so the loop that queries the DB
    // doesn't hold a write lock. If the slug was supplied explicitly we
    // require it to be free — no silent renaming.
    let slug: string;
    if (input.slug) {
      if (!isValidSlug(input.slug)) {
        throw new BadRequestException('INVALID_SLUG');
      }
      const taken = await this.prisma.company.findUnique({ where: { slug: input.slug } });
      if (taken) throw new ConflictException('SLUG_ALREADY_TAKEN');
      slug = input.slug;
    } else {
      slug = await uniqueSlug(derivateSlug(name), async (candidate) => {
        const existing = await this.prisma.company.findUnique({ where: { slug: candidate } });
        return existing === null;
      });
    }

    // Refuse to create if the HR email is already used ANYWHERE in the
    // system — `email` is @@unique in `User`. Doing this pre-check yields
    // a clearer error than the raw P2002 that would otherwise surface.
    const emailTaken = await this.prisma.user.findFirst({
      where: { email: hrEmail },
      select: { id: true },
    });
    if (emailTaken) throw new ConflictException('EMAIL_ALREADY_TAKEN');

    const temporaryPassword = generateTempPassword(14);
    const passwordHash = await this.passwords.hash(temporaryPassword);

    const { company, hrUser, leaveTypeCodes } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.company.create({
        data: { name, slug, timezone },
      });

      const leaveTypes = await Promise.all(
        DEFAULT_LEAVE_TYPES.map((t) =>
          tx.leaveType.create({
            data: {
              companyId: created.id,
              code: t.code,
              name: t.name,
              kind: t.kind,
              defaultAnnualQuota: t.defaultAnnualQuota,
              carryOverMax: t.carryOverMax,
              requiresAttachment: t.requiresAttachment,
            },
          }),
        ),
      );

      const hr = await tx.user.create({
        data: {
          companyId: created.id,
          email: hrEmail,
          fullName: hrFullName,
          role: 'HR_MANAGER',
          employmentStatus: EmploymentStatus.ACTIVE,
          hiredAt: new Date(),
          passwordHash,
          // Force rotation on first login — SUPER_ADMIN saw the temp password
          // once in the response, HR must pick their own now.
          mustChangePassword: true,
        },
      });

      // Seed initial LeaveBalance rows for the HR user so their leave UI
      // doesn't render with `-- / --` until January 1 of next year.
      const currentYear = new Date().getUTCFullYear();
      await this.seedLeaveBalances(tx, hr.id, currentYear, leaveTypes);

      await tx.auditLog.create({
        data: {
          // SUPER_ADMIN's own tenant is the audit-log home for cross-tenant
          // admin actions — this keeps every action reachable via the actor's
          // own company timeline. The `entityType='Company'` + `entityId`
          // pair points at the created tenant.
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'COMPANY_CREATED',
          entityType: 'Company',
          entityId: created.id,
          afterJson: {
            company: this.pickAuditableFields(created),
            hrUserId: hr.id,
            hrEmail: hr.email,
            seededLeaveTypeCodes: leaveTypes.map((t) => t.code),
          } as unknown as Prisma.InputJsonValue,
        },
      });

      return {
        company: created,
        hrUser: hr,
        leaveTypeCodes: leaveTypes.map((t) => t.code),
      };
    });

    const companyDto = await this.get(actor, company.id);
    return {
      company: companyDto,
      hrUserId: hrUser.id,
      hrEmail: hrUser.email,
      hrFullName: hrUser.fullName,
      temporaryPassword,
      seededLeaveTypeCodes: leaveTypeCodes,
    };
  }

  // ==================================================================
  // Update
  // ==================================================================

  async update(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateCompanyDto,
  ): Promise<CompanyAdminDto> {
    this.assertSuperAdmin(actor);

    if (Object.keys(input).length === 0) {
      throw new BadRequestException('EMPTY_UPDATE');
    }

    if (input.timezone !== undefined) {
      try {
        assertValidTimezone(input.timezone.trim());
      } catch (e) {
        if (e instanceof InvalidTimezoneError) {
          throw new BadRequestException({ code: e.code, message: e.message });
        }
        throw e;
      }
    }

    if (input.slug !== undefined) {
      if (!isValidSlug(input.slug)) {
        throw new BadRequestException('INVALID_SLUG');
      }
      const taken = await this.prisma.company.findFirst({
        where: { slug: input.slug, NOT: { id } },
        select: { id: true },
      });
      if (taken) throw new ConflictException('SLUG_ALREADY_TAKEN');
    }

    await this.prisma.$transaction(async (tx) => {
      const before = await tx.company.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('COMPANY_NOT_FOUND');

      const data: Prisma.CompanyUpdateInput = {};
      if (input.name !== undefined) data.name = input.name.trim();
      if (input.slug !== undefined) data.slug = input.slug;
      if (input.timezone !== undefined) data.timezone = input.timezone.trim();

      const after = await tx.company.update({ where: { id }, data });

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'COMPANY_UPDATED',
          entityType: 'Company',
          entityId: id,
          beforeJson: this.pickAuditableFields(before) as unknown as Prisma.InputJsonValue,
          afterJson: this.pickAuditableFields(after) as unknown as Prisma.InputJsonValue,
        },
      });
    });

    return this.get(actor, id);
  }

  // ==================================================================
  // Soft delete + restore
  // ==================================================================

  async softDelete(actor: AuthenticatedUser, id: string): Promise<void> {
    this.assertSuperAdmin(actor);

    // Guardrail — SUPER_ADMIN cannot delete their own tenant through this
    // endpoint. Doing so would immediately brick the caller's own session
    // and there is no "un-brick" path via the API.
    if (actor.companyId === id) {
      throw new ForbiddenException('CANNOT_DELETE_OWN_TENANT');
    }

    const existing = await this.prisma.company.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!existing) throw new NotFoundException('COMPANY_NOT_FOUND');
    if (existing.deletedAt) throw new BadRequestException('COMPANY_ALREADY_DELETED');

    const activeUsers = await this.prisma.user.count({
      where: { companyId: id, deletedAt: null },
    });
    if (activeUsers > 0) {
      throw new ConflictException({
        code: 'COMPANY_HAS_ACTIVE_USERS',
        message: `Cannot soft-delete: ${activeUsers} active user(s) remain. Deactivate them first.`,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.company.update({ where: { id }, data: { deletedAt: now } });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'COMPANY_SOFT_DELETED',
          entityType: 'Company',
          entityId: id,
          afterJson: { deletedAt: now.toISOString() } as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }

  async restore(actor: AuthenticatedUser, id: string): Promise<CompanyAdminDto> {
    this.assertSuperAdmin(actor);
    const existing = await this.prisma.company.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!existing) throw new NotFoundException('COMPANY_NOT_FOUND');
    if (!existing.deletedAt) throw new BadRequestException('COMPANY_NOT_DELETED');

    await this.prisma.$transaction(async (tx) => {
      await tx.company.update({ where: { id }, data: { deletedAt: null } });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'COMPANY_RESTORED',
          entityType: 'Company',
          entityId: id,
        },
      });
    });

    return this.get(actor, id);
  }

  // ==================================================================
  // Internals
  // ==================================================================

  private assertSuperAdmin(actor: AuthenticatedUser): void {
    if (actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('SUPER_ADMIN_REQUIRED');
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

  /** Fields safe to keep in an audit trail (never `passwordHash` etc.). */
  private pickAuditableFields(row: Company): Record<string, unknown> {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      timezone: row.timezone,
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    };
  }

  private toDto(row: CompanyWithCounts): CompanyAdminDto {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      timezone: row.timezone,
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      userCount: row._count.users,
      departmentCount: row._count.departments,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
