import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Timesheet, TimesheetPeriod, User } from '@prisma/client';
import { TimesheetPeriodType, TimesheetStatus } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatcher } from '../webhook/webhook-dispatcher.service';

import { TimesheetSubmissionService } from './timesheet-submission.service';

interface Kit {
  service: TimesheetSubmissionService;
  prisma: DeepMockProxy<PrismaService>;
  notifications: {
    createOne: jest.Mock;
  };
  webhookDispatcher: {
    enqueue: jest.Mock;
  };
}

function buildKit(): Kit {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);

  (prisma.$transaction as unknown as jest.Mock).mockImplementation(
    async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: PrismaService) => unknown)(prisma);
      }
      return Promise.all(arg as Promise<unknown>[]);
    },
  );

  const notifications = {
    createOne: jest.fn().mockResolvedValue(undefined),
  };

  const webhookDispatcher = {
    enqueue: jest.fn().mockResolvedValue(undefined),
  };

  const service = new TimesheetSubmissionService(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationService,
    webhookDispatcher as unknown as WebhookDispatcher,
  );

  return { service, prisma, notifications, webhookDispatcher };
}

function makeActor(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'actor-1',
    companyId: 'c-1',
    departmentId: null,
    email: 'actor@example.com',
    role: 'EMPLOYEE',
    ...overrides,
  };
}

function makeUser(overrides: Partial<User> = {}): Pick<
  User,
  'id' | 'supervisorId' | 'fullName' | 'email'
> {
  return {
    id: 'u-owner',
    supervisorId: 'sup-1',
    fullName: 'Owner Name',
    email: 'owner@example.com',
    ...overrides,
  } as User;
}

function makePeriod(overrides: Partial<TimesheetPeriod> = {}): TimesheetPeriod {
  return {
    id: 'p-1',
    companyId: 'c-1',
    periodType: TimesheetPeriodType.MONTHLY,
    // 2000-01-31 so it's clearly in the past
    periodStart: new Date('2000-01-01T00:00:00Z'),
    periodEnd: new Date('2000-01-31T00:00:00Z'),
    label: 'Januari 2000',
    generatedAt: new Date('2000-02-01T00:00:00Z'),
    createdAt: new Date('2000-02-01T00:00:00Z'),
    updatedAt: new Date('2000-02-01T00:00:00Z'),
    ...overrides,
  };
}

type TimesheetWithRelations = Timesheet & {
  period: TimesheetPeriod;
  user: Pick<User, 'id' | 'supervisorId' | 'fullName' | 'email'>;
};

function makeTimesheet(
  overrides: Partial<TimesheetWithRelations> = {},
): TimesheetWithRelations {
  return {
    id: 'ts-1',
    companyId: 'c-1',
    userId: 'u-owner',
    periodId: 'p-1',
    totalRegularHours: 0 as unknown as Timesheet['totalRegularHours'],
    totalOvertimeHours: 0 as unknown as Timesheet['totalOvertimeHours'],
    totalLeaveDays: 0,
    totalAbsentDays: 0,
    totalHolidays: 0,
    totalWorkingDays: 0,
    totalLateMinutes: 0,
    totalEarlyLeaveMinutes: 0,
    generatedAt: new Date('2000-02-01T00:00:00Z'),
    status: TimesheetStatus.DRAFT,
    submittedAt: null,
    supervisorId: null,
    supervisorAt: null,
    supervisorNote: null,
    hrManagerId: null,
    hrManagerAt: null,
    hrManagerNote: null,
    rejectedById: null,
    rejectedAt: null,
    rejectionReason: null,
    reopenCount: 0,
    lastReopenedAt: null,
    lastReopenedById: null,
    lastReopenReason: null,
    createdAt: new Date('2000-02-01T00:00:00Z'),
    updatedAt: new Date('2000-02-01T00:00:00Z'),
    period: makePeriod(),
    user: makeUser(),
    ...overrides,
  } as never;
}

describe('TimesheetSubmissionService.submit', () => {
  it('promotes DRAFT → PENDING_SUPERVISOR for the owner and notifies the supervisor', async () => {
    const kit = buildKit();
    const actor = makeActor({ id: 'u-owner' });
    const ts = makeTimesheet();
    kit.prisma.timesheet.findFirst.mockResolvedValue(ts);
    kit.prisma.timesheet.update.mockResolvedValue({
      ...ts,
      status: TimesheetStatus.PENDING_SUPERVISOR,
    } as never);
    kit.prisma.user.findUnique.mockResolvedValue({
      id: 'sup-1',
      email: 'sup@example.com',
    } as never);

    await kit.service.submit(actor, ts.id);

    expect(kit.prisma.timesheet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ts.id },
        data: expect.objectContaining({
          status: TimesheetStatus.PENDING_SUPERVISOR,
          supervisorId: 'sup-1',
        }),
      }),
    );
    expect(kit.notifications.createOne).toHaveBeenCalledTimes(1);
    expect(kit.prisma.auditLog.create).toHaveBeenCalled();
  });

  it('refuses when actor is not the owner (403)', async () => {
    const kit = buildKit();
    kit.prisma.timesheet.findFirst.mockResolvedValue(makeTimesheet());

    await expect(
      kit.service.submit(makeActor({ id: 'other-user' }), 'ts-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses when the period has not yet ended (409)', async () => {
    const kit = buildKit();
    const future = new Date(Date.now() + 30 * 24 * 3600_000);
    kit.prisma.timesheet.findFirst.mockResolvedValue(
      makeTimesheet({
        period: makePeriod({
          periodStart: new Date(Date.now() - 3600_000),
          periodEnd: future,
        }),
      }) as never,
    );

    await expect(
      kit.service.submit(makeActor({ id: 'u-owner' }), 'ts-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('surfaces NotFound for a foreign-tenant timesheet', async () => {
    const kit = buildKit();
    kit.prisma.timesheet.findFirst.mockResolvedValue(null);
    await expect(
      kit.service.submit(makeActor({ id: 'u-owner' }), 'ts-x'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TimesheetSubmissionService.decide', () => {
  it('requires a rejection note (409 without one)', async () => {
    const kit = buildKit();
    kit.prisma.timesheet.findFirst.mockResolvedValue(
      makeTimesheet({ status: TimesheetStatus.PENDING_SUPERVISOR }),
    );

    await expect(
      kit.service.decide(
        makeActor({ id: 'sup-1', role: 'SUPERVISOR' }),
        'ts-1',
        { action: 'SUPERVISOR_REJECT', note: '   ' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('supervisor of the owner moves PENDING_SUPERVISOR → PENDING_HR', async () => {
    const kit = buildKit();
    const ts = makeTimesheet({ status: TimesheetStatus.PENDING_SUPERVISOR });
    kit.prisma.timesheet.findFirst.mockResolvedValue(ts);
    kit.prisma.timesheet.update.mockResolvedValue({
      ...ts,
      status: TimesheetStatus.PENDING_HR,
    } as never);
    kit.prisma.user.findUnique.mockResolvedValue({
      id: 'sup-1',
      fullName: 'Supervisor',
    } as never);

    await kit.service.decide(
      makeActor({ id: 'sup-1', role: 'SUPERVISOR' }),
      ts.id,
      { action: 'SUPERVISOR_APPROVE' },
    );

    expect(kit.prisma.timesheet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: TimesheetStatus.PENDING_HR }),
      }),
    );
    expect(kit.notifications.createOne).toHaveBeenCalled();
  });

  it('non-team SUPERVISOR is forbidden (403)', async () => {
    const kit = buildKit();
    kit.prisma.timesheet.findFirst.mockResolvedValue(
      makeTimesheet({ status: TimesheetStatus.PENDING_SUPERVISOR }),
    );

    await expect(
      kit.service.decide(
        makeActor({ id: 'peer-1', role: 'SUPERVISOR' }),
        'ts-1',
        { action: 'SUPERVISOR_APPROVE' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('SUPERVISOR cannot HR-approve (403)', async () => {
    const kit = buildKit();
    kit.prisma.timesheet.findFirst.mockResolvedValue(
      makeTimesheet({ status: TimesheetStatus.PENDING_HR }),
    );

    await expect(
      kit.service.decide(
        makeActor({ id: 'sup-1', role: 'SUPERVISOR' }),
        'ts-1',
        { action: 'HR_APPROVE' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('HR_MANAGER promotes PENDING_HR → APPROVED', async () => {
    const kit = buildKit();
    const ts = makeTimesheet({ status: TimesheetStatus.PENDING_HR });
    kit.prisma.timesheet.findFirst.mockResolvedValue(ts);
    kit.prisma.timesheet.update.mockResolvedValue({
      ...ts,
      status: TimesheetStatus.APPROVED,
    } as never);
    kit.prisma.user.findUnique.mockResolvedValue({
      id: 'hr-1',
      fullName: 'HR Manager',
    } as never);

    await kit.service.decide(
      makeActor({ id: 'hr-1', role: 'HR_MANAGER' }),
      ts.id,
      { action: 'HR_APPROVE' },
    );

    expect(kit.prisma.timesheet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: TimesheetStatus.APPROVED }),
      }),
    );
  });

  it('rejects on illegal transition (approve from DRAFT) with 409', async () => {
    const kit = buildKit();
    kit.prisma.timesheet.findFirst.mockResolvedValue(
      makeTimesheet({ status: TimesheetStatus.DRAFT }),
    );

    await expect(
      kit.service.decide(
        makeActor({ id: 'hr-1', role: 'HR_MANAGER' }),
        'ts-1',
        { action: 'HR_APPROVE' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('TimesheetSubmissionService.reopen', () => {
  const okReason = 'OT rate revised post-payroll — re-verify manually';

  it('HR_MANAGER reopens APPROVED → DRAFT, bumps count, notifies owner+supervisor, enqueues webhook', async () => {
    const kit = buildKit();
    const ts = makeTimesheet({
      status: TimesheetStatus.APPROVED,
      supervisorId: 'sup-1',
      hrManagerId: 'hr-1',
      reopenCount: 0,
    });
    kit.prisma.timesheet.findFirst.mockResolvedValue(ts);
    kit.prisma.timesheet.update.mockResolvedValue({
      ...ts,
      status: TimesheetStatus.DRAFT,
      reopenCount: 1,
    } as never);
    // Sequenced findUnique: 1) actor.fullName, 2) supervisor row
    kit.prisma.user.findUnique
      .mockResolvedValueOnce({ fullName: 'HR Manager' } as never)
      .mockResolvedValueOnce({ id: 'sup-1', email: 'sup@example.com' } as never);

    const result = await kit.service.reopen(
      makeActor({ id: 'hr-1', role: 'HR_MANAGER' }),
      ts.id,
      `  ${okReason}  `,
    );

    expect(result).toEqual({
      id: ts.id,
      status: 'DRAFT',
      reopenCount: 1,
    });
    expect(kit.prisma.timesheet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DRAFT',
          reopenCount: 1,
          lastReopenReason: okReason,
          supervisorId: null,
          hrManagerId: null,
        }),
      }),
    );
    expect(kit.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'TIMESHEET_REOPENED',
          entityId: ts.id,
        }),
      }),
    );
    // Owner + supervisor = 2 notifications
    expect(kit.notifications.createOne).toHaveBeenCalledTimes(2);
    // Webhook fired AFTER commit
    expect(kit.webhookDispatcher.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'TIMESHEET_REOPENED',
        sourceId: `reopen_${ts.id}_1`,
        data: expect.objectContaining({
          timesheetId: ts.id,
          reopenCount: 1,
          reason: okReason,
        }),
      }),
    );
  });

  it('skips supervisor notification when HR is also the supervisor', async () => {
    const kit = buildKit();
    const ts = makeTimesheet({
      status: TimesheetStatus.APPROVED,
      user: makeUser({ supervisorId: 'hr-1' }),
    });
    kit.prisma.timesheet.findFirst.mockResolvedValue(ts);
    kit.prisma.timesheet.update.mockResolvedValue({
      ...ts,
      status: TimesheetStatus.DRAFT,
      reopenCount: 1,
    } as never);
    kit.prisma.user.findUnique.mockResolvedValueOnce({
      fullName: 'HR-Supervisor',
    } as never);

    await kit.service.reopen(
      makeActor({ id: 'hr-1', role: 'HR_MANAGER' }),
      ts.id,
      okReason,
    );

    // Owner only — supervisor lookup is short-circuited
    expect(kit.notifications.createOne).toHaveBeenCalledTimes(1);
  });

  it('refuses EMPLOYEE (403)', async () => {
    const kit = buildKit();
    kit.prisma.timesheet.findFirst.mockResolvedValue(
      makeTimesheet({ status: TimesheetStatus.APPROVED }),
    );

    await expect(
      kit.service.reopen(
        makeActor({ id: 'u-owner', role: 'EMPLOYEE' }),
        'ts-1',
        okReason,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(kit.webhookDispatcher.enqueue).not.toHaveBeenCalled();
  });

  it('refuses SUPERVISOR (403)', async () => {
    const kit = buildKit();
    kit.prisma.timesheet.findFirst.mockResolvedValue(
      makeTimesheet({ status: TimesheetStatus.APPROVED }),
    );

    await expect(
      kit.service.reopen(
        makeActor({ id: 'sup-1', role: 'SUPERVISOR' }),
        'ts-1',
        okReason,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses non-APPROVED status (409)', async () => {
    const kit = buildKit();
    kit.prisma.timesheet.findFirst.mockResolvedValue(
      makeTimesheet({ status: TimesheetStatus.PENDING_HR }),
    );

    await expect(
      kit.service.reopen(
        makeActor({ id: 'hr-1', role: 'HR_MANAGER' }),
        'ts-1',
        okReason,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses short reason (400)', async () => {
    const kit = buildKit();
    kit.prisma.timesheet.findFirst.mockResolvedValue(
      makeTimesheet({ status: TimesheetStatus.APPROVED }),
    );

    await expect(
      kit.service.reopen(
        makeActor({ id: 'hr-1', role: 'HR_MANAGER' }),
        'ts-1',
        'typo',
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('surfaces NotFound for foreign-tenant row', async () => {
    const kit = buildKit();
    kit.prisma.timesheet.findFirst.mockResolvedValue(null);

    await expect(
      kit.service.reopen(
        makeActor({ id: 'hr-1', role: 'HR_MANAGER' }),
        'ts-x',
        okReason,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
