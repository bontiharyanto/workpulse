import { ConflictException, NotFoundException } from '@nestjs/common';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import { LeaveTypeService } from './leave-type.service';

const hr: AuthenticatedUser = {
  id: 'user-hr',
  email: 'hr@a.test',
  companyId: 'company-1',
  departmentId: null,
  role: 'HR_MANAGER',
};

function makeRow(overrides: Partial<{ id: string; balances: number }> = {}) {
  return {
    id: overrides.id ?? 'lt-1',
    companyId: 'company-1',
    code: 'ANNUAL',
    name: 'Annual Leave',
    kind: 'ANNUAL',
    defaultAnnualQuota: 12,
    carryOverMax: 5,
    requiresAttachment: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    _count: { balances: overrides.balances ?? 0 },
  };
}

function setup(): { service: LeaveTypeService; prisma: DeepMockProxy<PrismaService> } {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  return { service: new LeaveTypeService(prisma), prisma };
}

function stubTx(prisma: DeepMockProxy<PrismaService>): void {
  type Cb = (tx: PrismaService) => Promise<unknown>;
  prisma.$transaction.mockImplementation(((cb: Cb | unknown) => {
    if (typeof cb === 'function') return (cb as Cb)(prisma);
    return Promise.resolve(cb);
  }) as never);
}

describe('LeaveTypeService.create', () => {
  it('backfills LeaveBalance for every ACTIVE user in the company', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.leaveType.create.mockResolvedValue({
      id: 'lt-new',
      companyId: 'company-1',
      code: 'PERSONAL',
      name: 'Personal',
      kind: 'PERSONAL',
      defaultAnnualQuota: 3,
      carryOverMax: 0,
      requiresAttachment: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    } as never);
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1' },
      { id: 'u2' },
      { id: 'u3' },
    ] as never);
    prisma.leaveBalance.createMany.mockResolvedValue({ count: 3 } as never);
    prisma.leaveType.findFirst.mockResolvedValue(
      makeRow({ id: 'lt-new', balances: 3 }) as never,
    );

    await service.create(hr, {
      code: '  personal ',
      name: 'Personal',
      kind: 'PERSONAL',
      defaultAnnualQuota: 3,
      carryOverMax: 0,
      requiresAttachment: false,
    });

    expect(prisma.leaveType.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          code: 'PERSONAL',
        }),
      }),
    );
    expect(prisma.leaveBalance.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ userId: 'u1', leaveTypeId: 'lt-new', quota: 3, remaining: 3 }),
          expect.objectContaining({ userId: 'u2', leaveTypeId: 'lt-new' }),
          expect.objectContaining({ userId: 'u3', leaveTypeId: 'lt-new' }),
        ],
        skipDuplicates: true,
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'LEAVE_TYPE_CREATED', entityId: 'lt-new' }),
      }),
    );
  });

  it('skips balance backfill when no active users exist', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.leaveType.create.mockResolvedValue({ id: 'lt-new' } as never);
    prisma.user.findMany.mockResolvedValue([] as never);
    prisma.leaveType.findFirst.mockResolvedValue(makeRow({ id: 'lt-new' }) as never);

    await service.create(hr, {
      code: 'ANNUAL',
      name: 'Annual',
      kind: 'ANNUAL',
      defaultAnnualQuota: 12,
      carryOverMax: 5,
      requiresAttachment: false,
    });

    expect(prisma.leaveBalance.createMany).not.toHaveBeenCalled();
  });

  it('maps unique code conflict to LEAVE_TYPE_CODE_TAKEN', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.leaveType.create.mockRejectedValue({ code: 'P2002' } as never);
    await expect(
      service.create(hr, {
        code: 'ANNUAL',
        name: 'Annual',
        kind: 'ANNUAL',
        defaultAnnualQuota: 12,
        carryOverMax: 0,
        requiresAttachment: false,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('LeaveTypeService.remove', () => {
  it('refuses when there are pending or upcoming approved requests', async () => {
    const { service, prisma } = setup();
    prisma.leaveType.findFirst.mockResolvedValue(makeRow() as never);
    prisma.leaveRequest.findFirst.mockResolvedValue({ id: 'lr-1' } as never);
    await expect(service.remove(hr, 'lt-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('soft-deletes when no open requests exist', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.leaveType.findFirst.mockResolvedValue(makeRow() as never);
    prisma.leaveRequest.findFirst.mockResolvedValue(null as never);
    prisma.leaveType.update.mockResolvedValue({
      ...makeRow(),
      deletedAt: new Date(),
    } as never);

    await service.remove(hr, 'lt-1');
    expect(prisma.leaveType.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });

  it('throws NotFound for cross-tenant lookup', async () => {
    const { service, prisma } = setup();
    prisma.leaveType.findFirst.mockResolvedValue(null as never);
    await expect(service.remove(hr, 'lt-other')).rejects.toBeInstanceOf(NotFoundException);
  });
});
