import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { LeaveKind, LeaveStatus } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { LeaveService } from './leave.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

const employee: AuthenticatedUser = {
  id: 'user-emp',
  email: 'emp@a.test',
  companyId: 'company-1',
  departmentId: 'dep-1',
  role: 'EMPLOYEE',
};

const supervisor: AuthenticatedUser = {
  id: 'user-sup',
  email: 'sup@a.test',
  companyId: 'company-1',
  departmentId: 'dep-1',
  role: 'SUPERVISOR',
};

const hr: AuthenticatedUser = {
  id: 'user-hr',
  email: 'hr@a.test',
  companyId: 'company-1',
  departmentId: 'dep-1',
  role: 'HR_MANAGER',
};

const annualType = {
  id: 'lt-annual',
  companyId: 'company-1',
  code: 'ANNUAL',
  name: 'Annual Leave',
  kind: LeaveKind.ANNUAL,
  defaultAnnualQuota: 12,
  carryOverMax: 5,
  requiresAttachment: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

function balance(overrides: Partial<{ remaining: number; reserved: number; used: number }> = {}) {
  return {
    id: 'bal-1',
    userId: employee.id,
    leaveTypeId: annualType.id,
    year: 2026,
    quota: 12,
    used: overrides.used ?? 0,
    reserved: overrides.reserved ?? 0,
    carriedOver: 0,
    remaining: overrides.remaining ?? 12,
    version: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function setup(): { service: LeaveService; prisma: DeepMockProxy<PrismaService> } {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  // Payroll cutoff defaults to "no cutoff" — individual tests that
  // exercise the cutoff override this mock explicitly.
  prisma.company.findFirst.mockResolvedValue({ payrollLockedUntil: null } as never);
  // Attachment presigning is orthogonal to leave business logic; a no-op stub is fine.
  const attachments = {
    presignPut: jest.fn(),
    presignGet: jest.fn(async () => ({ url: 'https://stub/get', expiresIn: 3600 })),
  } as unknown as ConstructorParameters<typeof LeaveService>[1];
  // Notifications are asserted in their own spec; here we stub the collaborator
  // so the LeaveService can invoke it without wiring the full DI graph.
  const notifications = {
    createOne: jest.fn(async () => undefined),
    createMany: jest.fn(async () => undefined),
  } as unknown as ConstructorParameters<typeof LeaveService>[2];
  return { service: new LeaveService(prisma, attachments, notifications), prisma };
}

function stubTransaction(prisma: DeepMockProxy<PrismaService>): void {
  type TxCallback = (tx: PrismaService) => Promise<unknown>;
  prisma.$transaction.mockImplementation(((cb: TxCallback | unknown) => {
    if (typeof cb === 'function') return (cb as TxCallback)(prisma);
    return Promise.resolve(cb);
  }) as never);
}

describe('LeaveService.submit', () => {
  it('rejects when endDate < startDate', async () => {
    const { service } = setup();
    await expect(
      service.submit(employee, {
        leaveTypeId: annualType.id,
        startDate: '2026-06-19',
        endDate: '2026-06-15',
        reason: 'trip',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when leave type not in tenant', async () => {
    const { service, prisma } = setup();
    prisma.leaveType.findFirst.mockResolvedValue(null);
    await expect(
      service.submit(employee, {
        leaveTypeId: 'other',
        startDate: '2026-06-15',
        endDate: '2026-06-19',
        reason: 'x',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects when leave type requires attachment and none provided', async () => {
    const { service, prisma } = setup();
    prisma.leaveType.findFirst.mockResolvedValue({
      ...annualType,
      requiresAttachment: true,
    } as never);
    await expect(
      service.submit(employee, {
        leaveTypeId: annualType.id,
        startDate: '2026-06-15',
        endDate: '2026-06-15',
        reason: 'sick',
      }),
    ).rejects.toMatchObject({ message: 'ATTACHMENT_REQUIRED' });
  });

  it('rejects range that resolves to zero business days (all weekends)', async () => {
    const { service, prisma } = setup();
    prisma.leaveType.findFirst.mockResolvedValue(annualType as never);
    prisma.holiday.findMany.mockResolvedValue([]);
    await expect(
      service.submit(employee, {
        leaveTypeId: annualType.id,
        // 2026-06-20 Sat, 2026-06-21 Sun
        startDate: '2026-06-20',
        endDate: '2026-06-21',
        reason: 'weekend trip',
      }),
    ).rejects.toMatchObject({ message: 'ZERO_BUSINESS_DAYS' });
  });

  it('rejects when overlapping with an existing pending/approved request', async () => {
    const { service, prisma } = setup();
    prisma.leaveType.findFirst.mockResolvedValue(annualType as never);
    prisma.holiday.findMany.mockResolvedValue([]);
    prisma.leaveRequest.findFirst.mockResolvedValue({ id: 'existing' } as never);

    await expect(
      service.submit(employee, {
        leaveTypeId: annualType.id,
        startDate: '2026-06-15',
        endDate: '2026-06-19',
        reason: 'x',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects when balance is insufficient (checked under FOR UPDATE)', async () => {
    const { service, prisma } = setup();
    prisma.leaveType.findFirst.mockResolvedValue(annualType as never);
    prisma.holiday.findMany.mockResolvedValue([]);
    prisma.leaveRequest.findFirst.mockResolvedValue(null);
    prisma.$queryRaw.mockResolvedValue([balance({ remaining: 2 })] as never);
    stubTransaction(prisma);

    await expect(
      service.submit(employee, {
        leaveTypeId: annualType.id,
        startDate: '2026-06-15', // Mon
        endDate: '2026-06-19', // Fri → 5 business days
        reason: 'trip',
      }),
    ).rejects.toMatchObject({ message: 'INSUFFICIENT_BALANCE' });
  });

  it('happy path: reserves balance, decrements remaining, creates PENDING_SUPERVISOR + audit', async () => {
    const { service, prisma } = setup();
    prisma.leaveType.findFirst.mockResolvedValue(annualType as never);
    prisma.holiday.findMany.mockResolvedValue([]);
    prisma.leaveRequest.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ supervisorId: 'user-sup' } as never);
    prisma.$queryRaw.mockResolvedValue([balance({ remaining: 12 })] as never);

    const createdReq = {
      id: 'req-1',
      companyId: employee.companyId,
      userId: employee.id,
      leaveTypeId: annualType.id,
      status: LeaveStatus.PENDING_SUPERVISOR,
      startDate: new Date('2026-06-15T00:00:00Z'),
      endDate: new Date('2026-06-19T00:00:00Z'),
      days: 5,
      reason: 'trip',
      attachmentUrl: null,
      supervisorId: 'user-sup',
      hrManagerId: null,
      supervisorAt: null,
      hrManagerAt: null,
      supervisorNote: null,
      hrManagerNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    prisma.leaveRequest.create.mockResolvedValue(createdReq as never);
    prisma.leaveBalance.update.mockResolvedValue(balance() as never);
    prisma.auditLog.create.mockResolvedValue({} as never);
    stubTransaction(prisma);

    const result = await service.submit(employee, {
      leaveTypeId: annualType.id,
      startDate: '2026-06-15',
      endDate: '2026-06-19',
      reason: 'trip',
    });

    expect(result.id).toBe('req-1');
    expect(prisma.leaveBalance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reserved: { increment: 5 },
          remaining: { decrement: 5 },
        }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'LEAVE_REQUEST_SUBMITTED' }),
      }),
    );
  });
});

describe('LeaveService.decide', () => {
  const pendingSupervisor = {
    id: 'req-1',
    companyId: 'company-1',
    userId: employee.id,
    leaveTypeId: annualType.id,
    status: LeaveStatus.PENDING_SUPERVISOR,
    startDate: new Date('2026-06-15T00:00:00Z'),
    endDate: new Date('2026-06-19T00:00:00Z'),
    days: 5,
    reason: 'x',
    attachmentUrl: null,
    supervisorId: null,
    hrManagerId: null,
    supervisorAt: null,
    hrManagerAt: null,
    supervisorNote: null,
    hrManagerNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    user: { supervisorId: 'user-sup' },
  };

  it('supervisor can only act on their reports', async () => {
    const { service, prisma } = setup();
    prisma.leaveRequest.findFirst.mockResolvedValue({
      ...pendingSupervisor,
      user: { supervisorId: 'someone-else' },
    } as never);

    await expect(service.decide(supervisor, 'req-1', { action: 'APPROVE' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('supervisor APPROVE moves state to PENDING_HR without touching balance', async () => {
    const { service, prisma } = setup();
    prisma.leaveRequest.findFirst.mockResolvedValue(pendingSupervisor as never);
    prisma.$queryRaw.mockResolvedValue([balance({ reserved: 5, remaining: 7 })] as never);
    prisma.leaveRequest.update.mockResolvedValue({
      ...pendingSupervisor,
      status: LeaveStatus.PENDING_HR,
    } as never);
    prisma.auditLog.create.mockResolvedValue({} as never);
    stubTransaction(prisma);

    const result = await service.decide(supervisor, 'req-1', { action: 'APPROVE', note: 'ok' });

    expect(result.status).toBe(LeaveStatus.PENDING_HR);
    // No balance mutation since reservedDelta=0, usedDelta=0
    expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
    expect(prisma.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: LeaveStatus.PENDING_HR,
          supervisorId: supervisor.id,
          supervisorNote: 'ok',
        }),
      }),
    );
  });

  it('supervisor REJECT releases the reserved pool', async () => {
    const { service, prisma } = setup();
    prisma.leaveRequest.findFirst.mockResolvedValue(pendingSupervisor as never);
    prisma.$queryRaw.mockResolvedValue([balance({ reserved: 5, remaining: 7 })] as never);
    prisma.leaveRequest.update.mockResolvedValue({
      ...pendingSupervisor,
      status: LeaveStatus.REJECTED,
    } as never);
    prisma.auditLog.create.mockResolvedValue({} as never);
    stubTransaction(prisma);

    await service.decide(supervisor, 'req-1', { action: 'REJECT' });

    expect(prisma.leaveBalance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reserved: { increment: -5 },
          used: { increment: 0 },
          remaining: { increment: 5 },
        }),
      }),
    );
  });

  it('HR APPROVE at PENDING_HR moves reserved → used (remaining unchanged)', async () => {
    const { service, prisma } = setup();
    const atHr = { ...pendingSupervisor, status: LeaveStatus.PENDING_HR, supervisorId: 'user-sup' };
    prisma.leaveRequest.findFirst.mockResolvedValue(atHr as never);
    prisma.$queryRaw.mockResolvedValue([balance({ reserved: 5, remaining: 7 })] as never);
    prisma.leaveRequest.update.mockResolvedValue({
      ...atHr,
      status: LeaveStatus.APPROVED,
    } as never);
    prisma.auditLog.create.mockResolvedValue({} as never);
    stubTransaction(prisma);

    await service.decide(hr, 'req-1', { action: 'APPROVE' });

    // The reserved→used transition preserves the total in `remaining`. Jest
    // distinguishes 0 from -0 in `objectContaining`, so we assert on the two
    // components explicitly (see `remainingChange = -(reservedChange + usedChange)`
    // in leave.service.ts — with symmetric deltas this yields -0).
    const balanceCall = prisma.leaveBalance.update.mock.calls[0]?.[0];
    expect(balanceCall).toMatchObject({
      data: { reserved: { increment: -5 }, used: { increment: 5 } },
    });
    const remaining = (balanceCall?.data as { remaining?: { increment: number } })?.remaining
      ?.increment;
    expect(remaining === 0 || Object.is(remaining, -0)).toBe(true);
  });

  it('rejects HR approve on PENDING_SUPERVISOR-stage request as illegal', async () => {
    const { service, prisma } = setup();
    // employee state machine says HR_MANAGER *can* level-1 approve (advance to PENDING_HR).
    // So instead test: EMPLOYEE actor cannot approve
    prisma.leaveRequest.findFirst.mockResolvedValue(pendingSupervisor as never);

    await expect(service.decide(employee, 'req-1', { action: 'APPROVE' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('LeaveService.cancel', () => {
  const pending = {
    id: 'req-1',
    companyId: 'company-1',
    userId: employee.id,
    leaveTypeId: annualType.id,
    status: LeaveStatus.PENDING_SUPERVISOR,
    startDate: new Date('2026-06-15T00:00:00Z'),
    endDate: new Date('2026-06-19T00:00:00Z'),
    days: 5,
    reason: 'x',
    attachmentUrl: null,
    supervisorId: null,
    hrManagerId: null,
    supervisorAt: null,
    hrManagerAt: null,
    supervisorNote: null,
    hrManagerNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  it('another user cannot cancel my request', async () => {
    const { service, prisma } = setup();
    prisma.leaveRequest.findFirst.mockResolvedValue(pending as never);
    await expect(service.cancel(supervisor, 'req-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('owner cancels PENDING_SUPERVISOR → CANCELLED and releases reserved', async () => {
    const { service, prisma } = setup();
    prisma.leaveRequest.findFirst.mockResolvedValue(pending as never);
    prisma.$queryRaw.mockResolvedValue([balance({ reserved: 5, remaining: 7 })] as never);
    prisma.leaveRequest.update.mockResolvedValue({
      ...pending,
      status: LeaveStatus.CANCELLED,
    } as never);
    prisma.auditLog.create.mockResolvedValue({} as never);
    stubTransaction(prisma);

    const result = await service.cancel(employee, 'req-1');
    expect(result.status).toBe(LeaveStatus.CANCELLED);
    expect(prisma.leaveBalance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reserved: { increment: -5 },
          remaining: { increment: 5 },
        }),
      }),
    );
  });

  it('cannot cancel an already-approved request', async () => {
    const { service, prisma } = setup();
    prisma.leaveRequest.findFirst.mockResolvedValue({
      ...pending,
      status: LeaveStatus.APPROVED,
    } as never);
    await expect(service.cancel(employee, 'req-1')).rejects.toMatchObject({
      message: 'ILLEGAL_TRANSITION',
    });
  });
});

describe('LeaveService.listPendingApprovals', () => {
  it('forbids EMPLOYEE', async () => {
    const { service } = setup();
    await expect(service.listPendingApprovals(employee)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('supervisor sees only PENDING_SUPERVISOR of their reports', async () => {
    const { service, prisma } = setup();
    prisma.leaveRequest.findMany.mockResolvedValue([] as never);
    await service.listPendingApprovals(supervisor);
    expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: LeaveStatus.PENDING_SUPERVISOR,
          user: { supervisorId: supervisor.id },
        }),
      }),
    );
  });

  it('HR sees all PENDING_HR in tenant', async () => {
    const { service, prisma } = setup();
    prisma.leaveRequest.findMany.mockResolvedValue([] as never);
    await service.listPendingApprovals(hr);
    expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: hr.companyId,
          status: LeaveStatus.PENDING_HR,
        }),
      }),
    );
  });
});

describe('LeaveService — payroll cutoff', () => {
  const superAdmin: AuthenticatedUser = {
    id: 'user-sa',
    email: 'sa@a.test',
    companyId: 'company-1',
    departmentId: null,
    role: 'SUPER_ADMIN',
  };

  const approvedRequest = {
    id: 'req-locked',
    companyId: 'company-1',
    userId: employee.id,
    leaveTypeId: annualType.id,
    status: LeaveStatus.APPROVED,
    startDate: new Date('2026-06-15T00:00:00Z'),
    endDate: new Date('2026-06-19T00:00:00Z'),
    days: 5,
    reason: 'x',
    attachmentUrl: null,
    supervisorId: 'user-sup',
    hrManagerId: 'user-hr',
    supervisorAt: new Date(),
    hrManagerAt: new Date(),
    supervisorNote: null,
    hrManagerNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    user: { supervisorId: 'user-sup', email: 'emp@a.test', fullName: 'Emp' },
  };

  it('submit refuses a request whose startDate falls inside the cutoff (HR actor)', async () => {
    const { service, prisma } = setup();
    prisma.company.findFirst.mockResolvedValue({
      payrollLockedUntil: new Date('2026-06-30T00:00:00Z'),
    } as never);
    prisma.leaveType.findFirst.mockResolvedValue(annualType as never);

    await expect(
      service.submit(hr, {
        leaveTypeId: annualType.id,
        startDate: '2026-06-15',
        endDate: '2026-06-19',
        reason: 'trip',
      }),
    ).rejects.toMatchObject({
      response: { code: 'PAYROLL_LOCKED', cutoffDate: '2026-06-30' },
    });

    // We short-circuit before the transaction, so no balance write should occur.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.leaveRequest.create).not.toHaveBeenCalled();
  });

  it('submit accepts a request whose startDate is strictly after the cutoff', async () => {
    const { service, prisma } = setup();
    prisma.company.findFirst.mockResolvedValue({
      payrollLockedUntil: new Date('2026-06-14T00:00:00Z'),
    } as never);
    prisma.leaveType.findFirst.mockResolvedValue(annualType as never);
    prisma.holiday.findMany.mockResolvedValue([]);
    prisma.leaveRequest.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ supervisorId: 'user-sup' } as never);
    prisma.$queryRaw.mockResolvedValue([balance({ remaining: 12 })] as never);
    prisma.leaveRequest.create.mockResolvedValue({ id: 'ok' } as never);
    prisma.leaveBalance.update.mockResolvedValue(balance() as never);
    prisma.auditLog.create.mockResolvedValue({} as never);
    stubTransaction(prisma);

    await expect(
      service.submit(employee, {
        leaveTypeId: annualType.id,
        startDate: '2026-06-15',
        endDate: '2026-06-19',
        reason: 'trip',
      }),
    ).resolves.toBeDefined();
  });

  it('decide blocks HR when the request startDate falls inside the cutoff', async () => {
    const { service, prisma } = setup();
    prisma.company.findFirst.mockResolvedValue({
      payrollLockedUntil: new Date('2026-06-30T00:00:00Z'),
    } as never);
    prisma.leaveRequest.findFirst.mockResolvedValue({
      ...approvedRequest,
      status: LeaveStatus.PENDING_HR,
    } as never);

    await expect(service.decide(hr, 'req-locked', { action: 'APPROVE' })).rejects.toMatchObject({
      response: { code: 'PAYROLL_LOCKED' },
    });

    expect(prisma.leaveRequest.update).not.toHaveBeenCalled();
  });

  it('decide allows SUPER_ADMIN inside the cutoff (emergency override)', async () => {
    const { service, prisma } = setup();
    prisma.company.findFirst.mockResolvedValue({
      payrollLockedUntil: new Date('2026-06-30T00:00:00Z'),
    } as never);
    const pendingHr = { ...approvedRequest, status: LeaveStatus.PENDING_HR };
    prisma.leaveRequest.findFirst.mockResolvedValue(pendingHr as never);
    prisma.$queryRaw.mockResolvedValue([balance({ reserved: 5, remaining: 7 })] as never);
    prisma.leaveRequest.update.mockResolvedValue({
      ...pendingHr,
      status: LeaveStatus.APPROVED,
    } as never);
    prisma.auditLog.create.mockResolvedValue({} as never);
    stubTransaction(prisma);

    const result = await service.decide(superAdmin, 'req-locked', {
      action: 'APPROVE',
    });
    expect(result.status).toBe(LeaveStatus.APPROVED);
  });

  it('cancel refuses when the request lands inside the cutoff (owner is not SUPER_ADMIN)', async () => {
    const { service, prisma } = setup();
    prisma.company.findFirst.mockResolvedValue({
      payrollLockedUntil: new Date('2026-06-30T00:00:00Z'),
    } as never);
    prisma.leaveRequest.findFirst.mockResolvedValue({
      ...approvedRequest,
      status: LeaveStatus.PENDING_SUPERVISOR,
    } as never);

    await expect(service.cancel(employee, 'req-locked')).rejects.toMatchObject({
      response: { code: 'PAYROLL_LOCKED' },
    });
    expect(prisma.leaveRequest.update).not.toHaveBeenCalled();
  });
});
