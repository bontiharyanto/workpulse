import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EmploymentStatus } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { UserAdminService } from './user-admin.service';
import { PasswordService } from '../auth/password.service';
import { TokenService } from '../auth/token.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';


const hr: AuthenticatedUser = {
  id: 'user-hr',
  email: 'hr@a.test',
  companyId: 'company-1',
  departmentId: null,
  role: 'HR_MANAGER',
  mustChangePassword: false,
};

const superAdmin: AuthenticatedUser = {
  id: 'user-root',
  email: 'root@a.test',
  companyId: 'company-1',
  departmentId: null,
  role: 'SUPER_ADMIN',
  mustChangePassword: false,
};

function makeUser(
  overrides: Partial<{
    id: string;
    email: string;
    role: 'EMPLOYEE' | 'SUPERVISOR' | 'HR_MANAGER' | 'SUPER_ADMIN';
    deletedAt: Date | null;
    departmentId: string | null;
    supervisorId: string | null;
  }> = {},
) {
  return {
    id: overrides.id ?? 'user-new',
    companyId: 'company-1',
    email: overrides.email ?? 'new@a.test',
    passwordHash: 'argon2hash',
    fullName: 'New User',
    role: overrides.role ?? 'EMPLOYEE',
    employmentStatus: EmploymentStatus.ACTIVE,
    hiredAt: new Date('2026-01-01T00:00:00Z'),
    supervisorId: overrides.supervisorId ?? null,
    departmentId: overrides.departmentId ?? null,
    timezone: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: overrides.deletedAt ?? null,
    department: null as null | { id: string; name: string },
    supervisor: null as null | { id: string; fullName: string },
  };
}

function setup(): {
  service: UserAdminService;
  prisma: DeepMockProxy<PrismaService>;
  passwords: DeepMockProxy<PasswordService>;
  tokens: DeepMockProxy<TokenService>;
} {
  const prisma = mockDeep<PrismaService>();
  const passwords = mockDeep<PasswordService>();
  const tokens = mockDeep<TokenService>();
  mockReset(prisma);
  mockReset(passwords);
  mockReset(tokens);
  passwords.hash.mockResolvedValue('argon2hash');
  return { service: new UserAdminService(prisma, passwords, tokens), prisma, passwords, tokens };
}

function stubTransaction(prisma: DeepMockProxy<PrismaService>): void {
  type TxCallback = (tx: PrismaService) => Promise<unknown>;
  prisma.$transaction.mockImplementation(((cb: TxCallback | unknown) => {
    if (typeof cb === 'function') return (cb as TxCallback)(prisma);
    return Promise.resolve(cb);
  }) as never);
}

// ==========================================================================
// create
// ==========================================================================
describe('UserAdminService.create', () => {
  it('forbids HR_MANAGER from creating SUPER_ADMIN', async () => {
    const { service } = setup();
    await expect(
      service.create(hr, {
        email: 'x@a.test',
        fullName: 'X',
        role: 'SUPER_ADMIN',
        hiredAt: '2026-01-01',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates user + leave balances + audit log inside a single transaction', async () => {
    const { service, prisma, passwords } = setup();
    stubTransaction(prisma);
    prisma.leaveType.findMany.mockResolvedValue([
      {
        id: 'lt-annual',
        companyId: 'company-1',
        code: 'ANNUAL',
        name: 'Annual',
        kind: 'ANNUAL',
        defaultAnnualQuota: 12,
        carryOverMax: 0,
        requiresAttachment: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ] as never);
    prisma.user.create.mockResolvedValue(makeUser({ id: 'new-emp' }) as never);
    prisma.user.findFirst.mockResolvedValue(makeUser({ id: 'new-emp' }) as never);
    prisma.leaveBalance.createMany.mockResolvedValue({ count: 1 } as never);

    const out = await service.create(hr, {
      email: 'Newbie@Acme.TEST ',
      fullName: '  Newbie ',
      role: 'EMPLOYEE',
      hiredAt: '2026-05-01',
    });

    expect(passwords.hash).toHaveBeenCalledTimes(1);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'newbie@acme.test',
          fullName: 'Newbie',
          companyId: 'company-1',
          role: 'EMPLOYEE',
          // Fase 27 — admin-issued temp password forces self-service rotation.
          mustChangePassword: true,
        }),
      }),
    );
    expect(prisma.leaveBalance.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ leaveTypeId: 'lt-annual', quota: 12, remaining: 12 })],
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'USER_CREATED', entityId: 'new-emp' }),
      }),
    );
    expect(out.temporaryPassword).toEqual(expect.any(String));
    expect(out.temporaryPassword.length).toBeGreaterThanOrEqual(14);
  });

  it('rejects a supervisor from another company', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(null as never); // supervisor lookup fails
    prisma.leaveType.findMany.mockResolvedValue([] as never);

    await expect(
      service.create(hr, {
        email: 'a@a.test',
        fullName: 'A',
        role: 'EMPLOYEE',
        supervisorId: 'other-company-user',
        hiredAt: '2026-01-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps unique-email conflict to CONFLICT EMAIL_ALREADY_TAKEN', async () => {
    const { service, prisma } = setup();
    stubTransaction(prisma);
    prisma.leaveType.findMany.mockResolvedValue([] as never);
    prisma.user.create.mockRejectedValue({ code: 'P2002' } as never);

    await expect(
      service.create(hr, {
        email: 'dup@a.test',
        fullName: 'Dup',
        role: 'EMPLOYEE',
        hiredAt: '2026-01-01',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

// ==========================================================================
// update
// ==========================================================================
describe('UserAdminService.update', () => {
  it('throws NotFound for a user in another company', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(null as never);
    await expect(service.update(hr, 'nope', { fullName: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('forbids HR_MANAGER from editing a SUPER_ADMIN', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(makeUser({ role: 'SUPER_ADMIN' }) as never);
    await expect(service.update(hr, 'user-root', { fullName: 'x' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('forbids HR_MANAGER from promoting anyone to SUPER_ADMIN', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(makeUser({ role: 'EMPLOYEE' }) as never);
    await expect(service.update(hr, 'user-new', { role: 'SUPER_ADMIN' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('forbids self role change', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(makeUser({ id: hr.id, role: 'HR_MANAGER' }) as never);
    await expect(service.update(hr, hr.id, { role: 'EMPLOYEE' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects supervisorId === user.id', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(makeUser({ id: 'u1', role: 'EMPLOYEE' }) as never);
    await expect(service.update(hr, 'u1', { supervisorId: 'u1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('happy path: writes update + audit log inside a transaction', async () => {
    const { service, prisma } = setup();
    stubTransaction(prisma);
    const existing = makeUser({ id: 'u1', role: 'EMPLOYEE' });
    prisma.user.findFirst.mockResolvedValue(existing as never);
    prisma.user.update.mockResolvedValue({ ...existing, fullName: 'Renamed' } as never);

    await service.update(hr, 'u1', { fullName: '  Renamed ' });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({ fullName: 'Renamed' }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'USER_UPDATED' }) }),
    );
  });
});

// ==========================================================================
// deactivate
// ==========================================================================
describe('UserAdminService.deactivate', () => {
  it('forbids self-deactivate', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(makeUser({ id: hr.id, role: 'HR_MANAGER' }) as never);
    await expect(service.deactivate(hr, hr.id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('soft-deletes, terminates, revokes tokens', async () => {
    const { service, prisma, tokens } = setup();
    stubTransaction(prisma);
    prisma.user.findFirst.mockResolvedValue(makeUser({ id: 'u1', role: 'EMPLOYEE' }) as never);
    prisma.user.update.mockResolvedValue(
      makeUser({ id: 'u1', role: 'EMPLOYEE', deletedAt: new Date() }) as never,
    );

    await service.deactivate(hr, 'u1');

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          employmentStatus: EmploymentStatus.TERMINATED,
        }),
      }),
    );
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith('u1', 'USER_DEACTIVATED');
  });
});

// ==========================================================================
// resetPassword
// ==========================================================================
describe('UserAdminService.resetPassword', () => {
  it('rotates password + revokes all refresh tokens + audit log', async () => {
    const { service, prisma, passwords, tokens } = setup();
    stubTransaction(prisma);
    prisma.user.findFirst.mockResolvedValue(makeUser({ id: 'u1', role: 'EMPLOYEE' }) as never);
    prisma.user.update.mockResolvedValue(makeUser({ id: 'u1' }) as never);

    const out = await service.resetPassword(hr, 'u1');

    expect(passwords.hash).toHaveBeenCalledTimes(1);
    // Fase 27 — admin reset re-arms mustChangePassword so the target must
    // rotate again on next login, even if they had picked their own password.
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({ mustChangePassword: true }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PASSWORD_RESET_BY_ADMIN',
          entityId: 'u1',
        }),
      }),
    );
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith('u1', 'PASSWORD_RESET_BY_ADMIN');
    expect(out.temporaryPassword).toEqual(expect.any(String));
  });

  it('forbids HR from resetting SUPER_ADMIN password', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(makeUser({ role: 'SUPER_ADMIN' }) as never);
    await expect(service.resetPassword(hr, 'root')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('SUPER_ADMIN can reset any password', async () => {
    const { service, prisma } = setup();
    stubTransaction(prisma);
    prisma.user.findFirst.mockResolvedValue(makeUser({ role: 'HR_MANAGER' }) as never);
    prisma.user.update.mockResolvedValue(makeUser({ role: 'HR_MANAGER' }) as never);

    await expect(service.resetPassword(superAdmin, 'user-new')).resolves.toBeDefined();
  });
});
