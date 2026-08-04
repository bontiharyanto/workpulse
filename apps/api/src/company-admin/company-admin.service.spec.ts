import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { CompanyAdminService } from './company-admin.service';
import type { PasswordService } from '../auth/password.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

const superAdmin: AuthenticatedUser = {
  id: 'root',
  email: 'root@workpulse.local',
  companyId: 'root-tenant',
  departmentId: null,
  role: 'SUPER_ADMIN',
};

const hrActor: AuthenticatedUser = {
  id: 'hr-1',
  email: 'hr@acme.test',
  companyId: 'co-1',
  departmentId: null,
  role: 'HR_MANAGER',
};

function setup(): {
  service: CompanyAdminService;
  prisma: DeepMockProxy<PrismaService>;
  passwords: jest.Mocked<PasswordService>;
} {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  const passwords = {
    hash: jest.fn().mockResolvedValue('hashed'),
    verify: jest.fn(),
    needsRehash: jest.fn(),
  } as unknown as jest.Mocked<PasswordService>;
  return {
    service: new CompanyAdminService(prisma, passwords),
    prisma,
    passwords,
  };
}

function stubTx(prisma: DeepMockProxy<PrismaService>): void {
  type Cb = (tx: PrismaService) => Promise<unknown>;
  prisma.$transaction.mockImplementation(((cb: Cb | unknown) => {
    if (typeof cb === 'function') return (cb as Cb)(prisma);
    return Promise.resolve(cb);
  }) as never);
}

function makeCompanyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'co-new',
    name: 'Acme',
    slug: 'acme',
    timezone: 'Asia/Jakarta',
    deletedAt: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    overtimeHourlyRate: null,
    overtimeWeekdayMultiplier: 1.5,
    overtimeWeekendMultiplier: 2.0,
    overtimeHolidayMultiplier: 3.0,
    overtimeMaxHoursPerDay: 4.0,
    overtimeSubmitWindowDays: 14,
    overtimeCompleteGraceDays: 2,
    absentScanGraceHours: 6,
    lastAbsentScanDate: null,
    payrollLockedUntil: null,
    _count: { users: 1, departments: 0 },
    ...overrides,
  };
}

// --------------------------------------------------------------------
// RBAC
// --------------------------------------------------------------------

describe('CompanyAdminService — RBAC gate', () => {
  it.each([
    ['list', (svc: CompanyAdminService) => svc.list(hrActor, {})],
    ['get', (svc: CompanyAdminService) => svc.get(hrActor, 'co-1')],
    [
      'create',
      (svc: CompanyAdminService) =>
        svc.create(hrActor, {
          name: 'X',
          hrEmail: 'x@y.com',
          hrFullName: 'X',
        }),
    ],
    ['update', (svc: CompanyAdminService) => svc.update(hrActor, 'co-1', { name: 'x' })],
    ['softDelete', (svc: CompanyAdminService) => svc.softDelete(hrActor, 'co-1')],
    ['restore', (svc: CompanyAdminService) => svc.restore(hrActor, 'co-1')],
  ])('refuses non-SUPER_ADMIN for %s', async (_name, fn) => {
    const { service } = setup();
    await expect(fn(service)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// --------------------------------------------------------------------
// Create — bootstrap
// --------------------------------------------------------------------

describe('CompanyAdminService.create', () => {
  it('rejects an invalid timezone before touching the DB', async () => {
    const { service, prisma } = setup();
    await expect(
      service.create(superAdmin, {
        name: 'Acme',
        hrEmail: 'hr@acme.com',
        hrFullName: 'Sarah',
        timezone: 'Asia/Jkt',
      }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVALID_TIMEZONE' }) });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an invalid explicit slug', async () => {
    const { service } = setup();
    await expect(
      service.create(superAdmin, {
        name: 'Acme',
        slug: 'Not_A_Slug',
        hrEmail: 'hr@acme.com',
        hrFullName: 'Sarah',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('conflicts when an explicit slug is already taken', async () => {
    const { service, prisma } = setup();
    prisma.company.findUnique.mockResolvedValueOnce(makeCompanyRow() as never);
    await expect(
      service.create(superAdmin, {
        name: 'Acme',
        slug: 'acme',
        hrEmail: 'hr@acme.com',
        hrFullName: 'Sarah',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('conflicts when HR email is already taken anywhere', async () => {
    const { service, prisma } = setup();
    // slug free
    prisma.company.findUnique.mockResolvedValueOnce(null);
    // email taken
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'existing-user' } as never);
    await expect(
      service.create(superAdmin, {
        name: 'Acme',
        slug: 'acme',
        hrEmail: 'hr@acme.com',
        hrFullName: 'Sarah',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('bootstraps company + 3 leave types + HR user in a single transaction, returns temp password', async () => {
    const { service, prisma, passwords } = setup();
    // findUnique is called twice: (1) slug uniqueness check → free (null),
    // (2) service.get() after the tx → returns the created row.
    prisma.company.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeCompanyRow() as never);
    prisma.user.findFirst.mockResolvedValueOnce(null);

    stubTx(prisma);

    const createdCompany = { id: 'co-new', name: 'Acme', slug: 'acme', timezone: 'Asia/Jakarta' };
    prisma.company.create.mockResolvedValueOnce(createdCompany as never);
    prisma.leaveType.create
      .mockResolvedValueOnce({ id: 'lt-1', code: 'ANNUAL', defaultAnnualQuota: 12 } as never)
      .mockResolvedValueOnce({ id: 'lt-2', code: 'SICK', defaultAnnualQuota: 14 } as never)
      .mockResolvedValueOnce({ id: 'lt-3', code: 'PERSONAL', defaultAnnualQuota: 3 } as never);
    prisma.user.create.mockResolvedValueOnce({
      id: 'hr-new',
      email: 'hr@acme.com',
      fullName: 'Sarah',
    } as never);

    const result = await service.create(superAdmin, {
      name: 'Acme',
      hrEmail: 'hr@acme.com',
      hrFullName: 'Sarah',
    });

    expect(passwords.hash).toHaveBeenCalledTimes(1);
    expect(result.temporaryPassword).toEqual(expect.any(String));
    expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(14);
    expect(result.hrEmail).toBe('hr@acme.com');
    expect(result.seededLeaveTypeCodes).toEqual(['ANNUAL', 'SICK', 'PERSONAL']);
    expect(result.company.slug).toBe('acme');

    expect(prisma.leaveType.create).toHaveBeenCalledTimes(3);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'co-new',
          email: 'hr@acme.com',
          role: 'HR_MANAGER',
          mustChangePassword: true,
          passwordHash: 'hashed',
        }),
      }),
    );
    expect(prisma.leaveBalance.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: superAdmin.companyId,
          action: 'COMPANY_CREATED',
          entityType: 'Company',
          entityId: 'co-new',
        }),
      }),
    );
  });

  it('derives a slug from the company name when none provided', async () => {
    const { service, prisma } = setup();
    prisma.company.findUnique
      .mockResolvedValueOnce(null) // slug uniqueness probe
      .mockResolvedValueOnce(makeCompanyRow({ slug: 'pt-acme-corp' }) as never); // get() re-read
    prisma.user.findFirst.mockResolvedValueOnce(null);
    stubTx(prisma);

    prisma.company.create.mockResolvedValueOnce({ id: 'co-x', slug: 'pt-acme-corp' } as never);
    prisma.leaveType.create.mockResolvedValue({ id: 'lt', code: 'ANNUAL' } as never);
    prisma.user.create.mockResolvedValueOnce({ id: 'hr' } as never);

    await service.create(superAdmin, {
      name: 'PT Acme Corp',
      hrEmail: 'unique@acme.com',
      hrFullName: 'HR',
    });

    expect(prisma.company.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slug: 'pt-acme-corp' }),
      }),
    );
  });
});

// --------------------------------------------------------------------
// Update
// --------------------------------------------------------------------

describe('CompanyAdminService.update', () => {
  it('rejects an empty patch', async () => {
    const { service } = setup();
    await expect(service.update(superAdmin, 'co-1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects when the new slug is already used by another tenant', async () => {
    const { service, prisma } = setup();
    prisma.company.findFirst.mockResolvedValueOnce({ id: 'other-tenant' } as never);
    await expect(service.update(superAdmin, 'co-1', { slug: 'taken' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('persists changes and writes an audit log', async () => {
    const { service, prisma } = setup();
    prisma.company.findFirst.mockResolvedValueOnce(null); // slug free
    stubTx(prisma);
    const before = makeCompanyRow();
    const after = makeCompanyRow({ name: 'Acme 2', slug: 'acme-2' });
    prisma.company.findUnique.mockResolvedValueOnce(before as never);
    prisma.company.update.mockResolvedValueOnce(after as never);
    // service.get() re-fetches at the end
    prisma.company.findUnique.mockResolvedValueOnce(after as never);

    const dto = await service.update(superAdmin, 'co-new', { name: 'Acme 2', slug: 'acme-2' });

    expect(dto.name).toBe('Acme 2');
    expect(dto.slug).toBe('acme-2');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'COMPANY_UPDATED',
          companyId: superAdmin.companyId,
          entityId: 'co-new',
        }),
      }),
    );
  });
});

// --------------------------------------------------------------------
// Soft-delete / restore
// --------------------------------------------------------------------

describe('CompanyAdminService.softDelete', () => {
  it('refuses to delete the caller\u2019s own tenant', async () => {
    const { service } = setup();
    await expect(service.softDelete(superAdmin, superAdmin.companyId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('throws when the target tenant is already deleted', async () => {
    const { service, prisma } = setup();
    prisma.company.findUnique.mockResolvedValueOnce({
      id: 'co-x',
      deletedAt: new Date(),
    } as never);
    await expect(service.softDelete(superAdmin, 'co-x')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws when the target has active users', async () => {
    const { service, prisma } = setup();
    prisma.company.findUnique.mockResolvedValueOnce({ id: 'co-x', deletedAt: null } as never);
    prisma.user.count.mockResolvedValueOnce(3);
    await expect(service.softDelete(superAdmin, 'co-x')).rejects.toBeInstanceOf(ConflictException);
  });

  it('soft-deletes and writes an audit log', async () => {
    const { service, prisma } = setup();
    prisma.company.findUnique.mockResolvedValueOnce({ id: 'co-x', deletedAt: null } as never);
    prisma.user.count.mockResolvedValueOnce(0);
    stubTx(prisma);
    prisma.company.update.mockResolvedValueOnce({} as never);

    await service.softDelete(superAdmin, 'co-x');

    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'co-x' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'COMPANY_SOFT_DELETED' }),
      }),
    );
  });
});

describe('CompanyAdminService.restore', () => {
  it('throws when the target is not deleted', async () => {
    const { service, prisma } = setup();
    prisma.company.findUnique.mockResolvedValueOnce({ id: 'co-x', deletedAt: null } as never);
    await expect(service.restore(superAdmin, 'co-x')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when the target does not exist', async () => {
    const { service, prisma } = setup();
    prisma.company.findUnique.mockResolvedValueOnce(null);
    await expect(service.restore(superAdmin, 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('restores and writes an audit log', async () => {
    const { service, prisma } = setup();
    prisma.company.findUnique.mockResolvedValueOnce({
      id: 'co-x',
      deletedAt: new Date(),
    } as never);
    stubTx(prisma);
    prisma.company.update.mockResolvedValueOnce({} as never);
    prisma.company.findUnique.mockResolvedValueOnce(makeCompanyRow({ id: 'co-x' }) as never);

    await service.restore(superAdmin, 'co-x');

    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'co-x' }, data: { deletedAt: null } }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'COMPANY_RESTORED' }),
      }),
    );
  });
});
