import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma as PrismaNs } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import { OvertimeService } from './overtime.service';

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

function d(n: number | string): PrismaNs.Decimal {
  return new PrismaNs.Decimal(n);
}

function makeUser(overrides: Partial<{ overtimeHourlyRate: PrismaNs.Decimal | null }> = {}) {
  return {
    id: employee.id,
    companyId: 'company-1',
    email: employee.email,
    fullName: 'Emp User',
    role: 'EMPLOYEE',
    employmentStatus: 'ACTIVE',
    departmentId: 'dep-1',
    supervisorId: supervisor.id,
    hiredAt: new Date('2025-01-01'),
    passwordHash: 'x',
    timezone: null,
    overtimeHourlyRate: overrides.overtimeHourlyRate ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    company: {
      id: 'company-1',
      name: 'Co',
      slug: 'co',
      timezone: 'UTC',
      overtimeHourlyRate: d(50_000),
      overtimeWeekdayMultiplier: d(1.5),
      overtimeWeekendMultiplier: d(2),
      overtimeHolidayMultiplier: d(3),
      overtimeMaxHoursPerDay: d(4),
      overtimeSubmitWindowDays: 14,
      payrollLockedUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    },
  };
}

function setup(): { service: OvertimeService; prisma: DeepMockProxy<PrismaService> } {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  // Default: no payroll cutoff. Individual cutoff tests override.
  prisma.company.findFirst.mockResolvedValue({ payrollLockedUntil: null } as never);
  const notifications = {
    createOne: jest.fn(async () => undefined),
    createMany: jest.fn(async () => undefined),
  } as unknown as ConstructorParameters<typeof OvertimeService>[1];
  return { service: new OvertimeService(prisma, notifications), prisma };
}

function stubTransaction(prisma: DeepMockProxy<PrismaService>): void {
  type TxCallback = (tx: PrismaService) => Promise<unknown>;
  prisma.$transaction.mockImplementation(((cb: TxCallback | unknown) => {
    if (typeof cb === 'function') return (cb as TxCallback)(prisma);
    return Promise.resolve(cb);
  }) as never);
}

const YESTERDAY = new Date();
YESTERDAY.setUTCDate(YESTERDAY.getUTCDate() - 1);
const YESTERDAY_ISO = YESTERDAY.toISOString().slice(0, 10);

describe('OvertimeService.submit', () => {
  it('rejects a future workDate', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValueOnce(makeUser() as never);
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    await expect(
      service.submit(employee, { workDate: tomorrow.toISOString().slice(0, 10), hours: 2, reason: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a workDate older than the submit window', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValueOnce(makeUser() as never);
    const old = new Date();
    old.setUTCDate(old.getUTCDate() - 30);
    await expect(
      service.submit(employee, { workDate: old.toISOString().slice(0, 10), hours: 2, reason: 'x' }),
    ).rejects.toThrow(/OUTSIDE_SUBMIT_WINDOW/);
  });

  it('rejects hours over the company daily cap', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValueOnce(makeUser() as never);
    await expect(
      service.submit(employee, { workDate: YESTERDAY_ISO, hours: 5, reason: 'x' }),
    ).rejects.toThrow(/HOURS_EXCEEDS_DAILY_CAP/);
  });

  it('rejects a duplicate active OT for the same date', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValueOnce(makeUser() as never);
    prisma.overtimeRequest.findFirst.mockResolvedValueOnce({ id: 'existing' } as never);
    await expect(
      service.submit(employee, { workDate: YESTERDAY_ISO, hours: 2, reason: 'x' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('maps a Prisma P2002 (partial unique race) to DUPLICATE_WORK_DATE', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValueOnce(makeUser() as never);
    // App-level duplicate check finds nothing — this simulates the moment
    // between two concurrent workers where neither has committed yet.
    prisma.overtimeRequest.findFirst.mockResolvedValueOnce(null);
    prisma.holiday.findMany.mockResolvedValueOnce([]);
    stubTransaction(prisma);
    // Second worker's INSERT hits the partial unique index; Prisma surfaces
    // it as P2002 which the service must translate into 409 DUPLICATE_WORK_DATE.
    prisma.overtimeRequest.create.mockRejectedValueOnce(
      new PrismaNs.PrismaClientKnownRequestError('unique violation', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['OvertimeRequest_userId_workDate_active_uidx'] },
      }),
    );

    await expect(
      service.submit(employee, { workDate: YESTERDAY_ISO, hours: 2, reason: 'race' }),
    ).rejects.toMatchObject({ message: 'DUPLICATE_WORK_DATE' });
  });

  it('rejects when neither user nor company overtime rate is configured', async () => {
    const { service, prisma } = setup();
    const user = makeUser();
    user.company.overtimeHourlyRate = null as unknown as PrismaNs.Decimal;
    prisma.user.findFirst.mockResolvedValueOnce(user as never);
    prisma.overtimeRequest.findFirst.mockResolvedValueOnce(null);
    prisma.holiday.findMany.mockResolvedValueOnce([]);
    await expect(
      service.submit(employee, { workDate: YESTERDAY_ISO, hours: 2, reason: 'x' }),
    ).rejects.toThrow(/OVERTIME_RATE_NOT_CONFIGURED/);
  });

  it('creates a request with computed rate + audit on happy path', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValueOnce(makeUser() as never);
    prisma.overtimeRequest.findFirst.mockResolvedValueOnce(null);
    prisma.holiday.findMany.mockResolvedValueOnce([]);
    stubTransaction(prisma);
    prisma.overtimeRequest.create.mockResolvedValueOnce({ id: 'ot-1' } as never);

    await service.submit(employee, {
      workDate: YESTERDAY_ISO,
      hours: 2,
      reason: 'Deadline crunch',
    });

    expect(prisma.overtimeRequest.create).toHaveBeenCalledTimes(1);
    const createArg = prisma.overtimeRequest.create.mock.calls[0]?.[0].data;
    if (!createArg) throw new Error('overtimeRequest.create was not invoked');
    expect(createArg.status).toBe('PENDING_APPROVAL');
    expect(createArg.hours.toString()).toBe('2');
    // 50000 base × (1.5 weekday | 2 weekend depending on day) — just verify it's positive.
    expect(Number(createArg.ratePerHour.toString())).toBeGreaterThan(0);
    expect(Number(createArg.totalAmount.toString())).toBeGreaterThan(0);

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'OVERTIME_SUBMITTED' }),
      }),
    );
  });
});

describe('OvertimeService.decide', () => {
  const baseRow = {
    id: 'ot-1',
    companyId: 'company-1',
    userId: employee.id,
    workDate: YESTERDAY,
    hours: d(2),
    reason: 'x',
    status: 'PENDING_APPROVAL' as const,
    baseRate: d(50_000),
    rateMultiplier: d(1.5),
    ratePerHour: d(75_000),
    totalAmount: d(150_000),
    approvedById: null,
    approvedAt: null,
    rejectedAt: null,
    decisionNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    user: { supervisorId: supervisor.id },
  };

  it('supervisor can approve their team member', async () => {
    const { service, prisma } = setup();
    prisma.overtimeRequest.findFirst.mockResolvedValueOnce(baseRow as never);
    stubTransaction(prisma);
    prisma.overtimeRequest.update.mockResolvedValueOnce({
      ...baseRow,
      status: 'APPROVED',
    } as never);

    const res = await service.decide(supervisor, 'ot-1', { action: 'APPROVE' });
    expect(res.status).toBe('APPROVED');
    expect(prisma.overtimeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'APPROVED', approvedById: supervisor.id }),
      }),
    );
  });

  it('a different supervisor cannot approve someone else\u2019s team member', async () => {
    const { service, prisma } = setup();
    prisma.overtimeRequest.findFirst.mockResolvedValueOnce(baseRow as never);
    const otherSup: AuthenticatedUser = { ...supervisor, id: 'other-sup' };
    await expect(
      service.decide(otherSup, 'ot-1', { action: 'APPROVE' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('HR can approve anyone', async () => {
    const { service, prisma } = setup();
    prisma.overtimeRequest.findFirst.mockResolvedValueOnce(baseRow as never);
    stubTransaction(prisma);
    prisma.overtimeRequest.update.mockResolvedValueOnce({
      ...baseRow,
      status: 'APPROVED',
    } as never);
    await expect(service.decide(hr, 'ot-1', { action: 'APPROVE' })).resolves.toMatchObject({
      status: 'APPROVED',
    });
  });

  it('cannot decide on a non-pending row', async () => {
    const { service, prisma } = setup();
    prisma.overtimeRequest.findFirst.mockResolvedValueOnce({
      ...baseRow,
      status: 'APPROVED',
    } as never);
    await expect(
      service.decide(hr, 'ot-1', { action: 'APPROVE' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('404 when the row does not exist in tenant', async () => {
    const { service, prisma } = setup();
    prisma.overtimeRequest.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.decide(hr, 'ot-1', { action: 'APPROVE' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OvertimeService.cancel', () => {
  it('owner can cancel own PENDING request', async () => {
    const { service, prisma } = setup();
    prisma.overtimeRequest.findFirst.mockResolvedValueOnce({
      id: 'ot-1',
      companyId: 'company-1',
      userId: employee.id,
      status: 'PENDING_APPROVAL',
      deletedAt: null,
    } as never);
    stubTransaction(prisma);
    prisma.overtimeRequest.update.mockResolvedValueOnce({ status: 'CANCELLED' } as never);

    const res = await service.cancel(employee, 'ot-1');
    expect(res.status).toBe('CANCELLED');
  });

  it('non-owner cannot cancel', async () => {
    const { service, prisma } = setup();
    prisma.overtimeRequest.findFirst.mockResolvedValueOnce({
      id: 'ot-1',
      companyId: 'company-1',
      userId: 'someone-else',
      status: 'PENDING_APPROVAL',
      deletedAt: null,
    } as never);
    await expect(service.cancel(employee, 'ot-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('OvertimeService \u2014 payroll cutoff', () => {
  const superAdmin: AuthenticatedUser = {
    id: 'user-sa',
    email: 'sa@a.test',
    companyId: 'company-1',
    departmentId: null,
    role: 'SUPER_ADMIN',
  };

  // A row that lives one week in the past; the cutoff we install below is
  // "yesterday", so this row is safely inside the frozen window.
  const inLockedWindow = new Date();
  inLockedWindow.setUTCDate(inLockedWindow.getUTCDate() - 8);

  const yesterdayCutoff = new Date();
  yesterdayCutoff.setUTCDate(yesterdayCutoff.getUTCDate() - 1);
  yesterdayCutoff.setUTCHours(0, 0, 0, 0);

  it('submit refuses when workDate falls inside the cutoff (HR actor)', async () => {
    const { service, prisma } = setup();
    // Company loaded during submit carries a cutoff; that's what the guard sees.
    prisma.user.findFirst.mockResolvedValueOnce({
      ...makeUser(),
      company: {
        ...makeUser().company,
        payrollLockedUntil: yesterdayCutoff,
      },
    } as never);

    const workIso = inLockedWindow.toISOString().slice(0, 10);
    await expect(
      service.submit(hr, { workDate: workIso, hours: 2, reason: 'x' }),
    ).rejects.toMatchObject({
      response: { code: 'PAYROLL_LOCKED' },
    });

    // Refuses without ever touching the request table.
    expect(prisma.overtimeRequest.findFirst).not.toHaveBeenCalled();
    expect(prisma.overtimeRequest.create).not.toHaveBeenCalled();
  });

  it('submit allows SUPER_ADMIN inside the cutoff (emergency override)', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValueOnce({
      ...makeUser(),
      id: 'user-sa',
      company: {
        ...makeUser().company,
        payrollLockedUntil: yesterdayCutoff,
      },
    } as never);
    prisma.overtimeRequest.findFirst.mockResolvedValueOnce(null);
    prisma.holiday.findMany.mockResolvedValueOnce([] as never);
    prisma.overtimeRequest.create.mockResolvedValueOnce({ id: 'ot-new' } as never);
    prisma.auditLog.create.mockResolvedValueOnce({} as never);
    stubTransaction(prisma);

    const workIso = inLockedWindow.toISOString().slice(0, 10);
    // We only need to see the transaction start (past the cutoff guard) — the
    // full happy-path is covered by the sibling describe block.
    await expect(
      service.submit(superAdmin, { workDate: workIso, hours: 2, reason: 'x' }),
    ).resolves.toBeDefined();
  });

  it('decide refuses when workDate is inside the cutoff', async () => {
    const { service, prisma } = setup();
    prisma.overtimeRequest.findFirst.mockResolvedValueOnce({
      id: 'ot-locked',
      companyId: 'company-1',
      userId: employee.id,
      workDate: inLockedWindow,
      hours: d(2),
      status: 'PENDING_APPROVAL',
      deletedAt: null,
      user: { supervisorId: supervisor.id, email: 'emp@a.test', fullName: 'Emp' },
    } as never);
    prisma.company.findFirst.mockResolvedValueOnce({
      payrollLockedUntil: yesterdayCutoff,
    } as never);

    await expect(
      service.decide(hr, 'ot-locked', { action: 'APPROVE' }),
    ).rejects.toMatchObject({
      response: { code: 'PAYROLL_LOCKED' },
    });

    expect(prisma.overtimeRequest.update).not.toHaveBeenCalled();
  });

  it('cancel refuses when the request workDate is inside the cutoff', async () => {
    const { service, prisma } = setup();
    prisma.overtimeRequest.findFirst.mockResolvedValueOnce({
      id: 'ot-locked',
      companyId: 'company-1',
      userId: employee.id,
      workDate: inLockedWindow,
      status: 'PENDING_APPROVAL',
      deletedAt: null,
    } as never);
    prisma.company.findFirst.mockResolvedValueOnce({
      payrollLockedUntil: yesterdayCutoff,
    } as never);

    await expect(service.cancel(employee, 'ot-locked')).rejects.toMatchObject({
      response: { code: 'PAYROLL_LOCKED' },
    });
    expect(prisma.overtimeRequest.update).not.toHaveBeenCalled();
  });
});
