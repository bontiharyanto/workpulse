import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { AttendanceCorrectionService } from './attendance-correction.service';
import { AttachmentService } from '../attachment/attachment.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { NotificationService } from '../notification/notification.service';
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

const superAdmin: AuthenticatedUser = {
  id: 'user-super',
  email: 'super@a.test',
  companyId: 'company-1',
  departmentId: 'dep-1',
  role: 'SUPER_ADMIN',
};

function ymd(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * Pick a workDate that is guaranteed to be strictly BEFORE today (UTC).
 * Prevents flakes when the suite runs on the same UTC day at 00:xx.
 */
const YESTERDAY = (() => {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
})();
const YESTERDAY_DATE = ymd(YESTERDAY);

function makeUserRow(
  overrides: Partial<{
    id: string;
    supervisorId: string | null;
    hiredAt: Date | null;
    payrollLockedUntil: Date | null;
  }> = {},
) {
  return {
    id: overrides.id ?? employee.id,
    supervisorId: 'supervisorId' in overrides ? (overrides.supervisorId ?? null) : supervisor.id,
    hiredAt: 'hiredAt' in overrides ? overrides.hiredAt : new Date('2020-01-01'),
    company: {
      payrollLockedUntil:
        'payrollLockedUntil' in overrides ? (overrides.payrollLockedUntil ?? null) : null,
    },
  };
}

function makeCorrection(
  overrides: Partial<{
    id: string;
    userId: string;
    supervisorId: string | null;
    status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
    requestedClockInAt: Date | null;
    requestedClockOutAt: Date | null;
    workDate: Date;
    userEmail: string;
    userFullName: string;
    userSupervisorId: string | null;
  }> = {},
) {
  return {
    id: overrides.id ?? 'corr-1',
    companyId: 'company-1',
    userId: overrides.userId ?? employee.id,
    workDate: overrides.workDate ?? YESTERDAY_DATE,
    requestedClockInAt:
      'requestedClockInAt' in overrides
        ? (overrides.requestedClockInAt ?? null)
        : new Date(`${YESTERDAY}T09:00:00.000Z`),
    requestedClockOutAt:
      'requestedClockOutAt' in overrides
        ? (overrides.requestedClockOutAt ?? null)
        : new Date(`${YESTERDAY}T18:00:00.000Z`),
    reason: 'lupa punch',
    attachmentUrl: null,
    status: overrides.status ?? 'PENDING_APPROVAL',
    supervisorId: 'supervisorId' in overrides ? (overrides.supervisorId ?? null) : supervisor.id,
    decidedById: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    user: {
      supervisorId:
        'userSupervisorId' in overrides ? (overrides.userSupervisorId ?? null) : supervisor.id,
      email: overrides.userEmail ?? employee.email,
      fullName: overrides.userFullName ?? 'Emp User',
    },
  };
}

function setup(): {
  service: AttendanceCorrectionService;
  prisma: DeepMockProxy<PrismaService>;
  notifications: jest.Mocked<Pick<NotificationService, 'createOne'>>;
  timesheet: {
    assertCorrectionAllowed: jest.Mock;
    regenerateForCorrection: jest.Mock;
  };
} {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);

  // $transaction: execute the callback with the same mocked client.
  (prisma.$transaction as unknown as jest.Mock).mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: PrismaService) => unknown)(prisma);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });

  const notifications = {
    createOne: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Pick<NotificationService, 'createOne'>>;

  const attachments = { presignGet: jest.fn() } as unknown as AttachmentService;

  const timesheet = {
    assertCorrectionAllowed: jest.fn().mockResolvedValue(undefined),
    regenerateForCorrection: jest.fn().mockResolvedValue({ regenerated: true, wasPending: false }),
  };

  const service = new AttendanceCorrectionService(
    prisma as unknown as PrismaService,
    attachments,
    notifications as unknown as NotificationService,
    timesheet as unknown as import('../timesheet/timesheet.service').TimesheetService,
  );

  return { service, prisma, notifications, timesheet };
}

// ---------------------------------------------------------------------------
// submit
// ---------------------------------------------------------------------------

describe('AttendanceCorrectionService.submit', () => {
  it('creates a PENDING_APPROVAL row for a valid single-clockOut correction', async () => {
    const { service, prisma, notifications } = setup();
    prisma.user.findFirst.mockResolvedValue(makeUserRow() as never);
    prisma.attendanceCorrection.findFirst.mockResolvedValue(null);
    prisma.attendanceCorrection.create.mockResolvedValue(makeCorrection() as never);
    prisma.auditLog.create.mockResolvedValue({} as never);
    prisma.user.findUnique
      .mockResolvedValueOnce({ fullName: 'Emp User', email: 'emp@a.test' } as never)
      .mockResolvedValueOnce({ email: 'sup@a.test' } as never);

    const created = await service.submit(employee, {
      workDate: YESTERDAY,
      requestedClockInAt: null,
      requestedClockOutAt: `${YESTERDAY}T18:00:00.000Z`,
      reason: 'lupa clock-out',
    });

    expect(created.status).toBe('PENDING_APPROVAL');
    const createArg = prisma.attendanceCorrection.create.mock.calls[0]?.[0].data;
    if (!createArg) throw new Error('create was not invoked');
    expect(createArg.userId).toBe(employee.id);
    expect(createArg.workDate).toEqual(YESTERDAY_DATE);
    expect(createArg.requestedClockInAt).toBeNull();
    expect(createArg.requestedClockOutAt).toEqual(new Date(`${YESTERDAY}T18:00:00.000Z`));
    expect(notifications.createOne).toHaveBeenCalledTimes(1);
  });

  it('rejects a future workDate with DATE_IN_FUTURE', async () => {
    const { service, prisma } = setup();
    const tomorrow = (() => {
      const t = new Date();
      t.setUTCDate(t.getUTCDate() + 1);
      return t.toISOString().slice(0, 10);
    })();
    await expect(
      service.submit(employee, {
        workDate: tomorrow,
        requestedClockInAt: `${tomorrow}T09:00:00.000Z`,
        requestedClockOutAt: `${tomorrow}T18:00:00.000Z`,
        reason: 'x',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.attendanceCorrection.create).not.toHaveBeenCalled();
  });

  it('rejects when both requested times are null (AT_LEAST_ONE_TIME)', async () => {
    const { service } = setup();
    await expect(
      service.submit(employee, {
        workDate: YESTERDAY,
        requestedClockInAt: null,
        requestedClockOutAt: null,
        reason: 'no times',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a workDate before hiredAt', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(
      makeUserRow({ hiredAt: new Date('2099-01-01') }) as never,
    );
    await expect(
      service.submit(employee, {
        workDate: YESTERDAY,
        requestedClockInAt: `${YESTERDAY}T09:00:00.000Z`,
        requestedClockOutAt: `${YESTERDAY}T18:00:00.000Z`,
        reason: 'x',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a duplicate PENDING correction for the same (userId, workDate)', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(makeUserRow() as never);
    prisma.attendanceCorrection.findFirst.mockResolvedValue({ id: 'existing' } as never);
    await expect(
      service.submit(employee, {
        workDate: YESTERDAY,
        requestedClockInAt: `${YESTERDAY}T09:00:00.000Z`,
        requestedClockOutAt: `${YESTERDAY}T18:00:00.000Z`,
        reason: 'x',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a payroll-locked workDate for HR (409 PAYROLL_LOCKED)', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(
      makeUserRow({ payrollLockedUntil: YESTERDAY_DATE }) as never,
    );
    prisma.attendanceCorrection.findFirst.mockResolvedValue(null);
    await expect(
      service.submit(hr, {
        workDate: YESTERDAY,
        requestedClockInAt: `${YESTERDAY}T09:00:00.000Z`,
        requestedClockOutAt: `${YESTERDAY}T18:00:00.000Z`,
        reason: 'x',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows a SUPER_ADMIN to submit inside a locked period (bypass)', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(
      makeUserRow({ payrollLockedUntil: YESTERDAY_DATE }) as never,
    );
    prisma.attendanceCorrection.findFirst.mockResolvedValue(null);
    prisma.attendanceCorrection.create.mockResolvedValue(makeCorrection() as never);
    prisma.auditLog.create.mockResolvedValue({} as never);
    prisma.user.findUnique.mockResolvedValue({ fullName: 'x', email: 'x' } as never);
    const created = await service.submit(superAdmin, {
      workDate: YESTERDAY,
      requestedClockInAt: null,
      requestedClockOutAt: `${YESTERDAY}T18:00:00.000Z`,
      reason: 'auditor amendment',
    });
    expect(created.status).toBe('PENDING_APPROVAL');
  });
});

// ---------------------------------------------------------------------------
// decide
// ---------------------------------------------------------------------------

describe('AttendanceCorrectionService.decide', () => {
  it('supervisor of the team may APPROVE a pending correction', async () => {
    const { service, prisma } = setup();
    prisma.attendanceCorrection.findFirst.mockResolvedValue(makeCorrection() as never);
    prisma.company.findFirst.mockResolvedValue({ payrollLockedUntil: null } as never);
    prisma.attendanceRecord.findFirst.mockResolvedValue(null);
    prisma.userShiftAssignment.findFirst.mockResolvedValue({
      shiftId: 'shift-1',
    } as never);
    prisma.attendanceRecord.create.mockResolvedValue({ id: 'att-new' } as never);
    prisma.absenceRecord.deleteMany.mockResolvedValue({ count: 0 } as never);
    prisma.attendanceCorrection.update.mockResolvedValue({
      ...makeCorrection(),
      status: 'APPROVED',
    } as never);
    prisma.auditLog.create.mockResolvedValue({} as never);
    prisma.user.findUnique.mockResolvedValue({ fullName: 'Sup' } as never);

    const updated = await service.decide(supervisor, 'corr-1', {
      action: 'APPROVE',
    });
    expect(updated.status).toBe('APPROVED');
    expect(prisma.attendanceRecord.create).toHaveBeenCalledTimes(1);
    expect(prisma.absenceRecord.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('supervisor NOT in the reporting line is forbidden', async () => {
    const { service, prisma } = setup();
    prisma.attendanceCorrection.findFirst.mockResolvedValue(
      makeCorrection({ userSupervisorId: 'other-sup' }) as never,
    );
    prisma.company.findFirst.mockResolvedValue({ payrollLockedUntil: null } as never);
    await expect(
      service.decide(supervisor, 'corr-1', { action: 'APPROVE' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('HR PATCHES an existing record when only clockOutAt is missing', async () => {
    const { service, prisma } = setup();
    prisma.attendanceCorrection.findFirst.mockResolvedValue(
      makeCorrection({
        requestedClockInAt: null,
        requestedClockOutAt: new Date(`${YESTERDAY}T18:00:00.000Z`),
      }) as never,
    );
    prisma.company.findFirst.mockResolvedValue({ payrollLockedUntil: null } as never);
    prisma.attendanceRecord.findFirst.mockResolvedValue({
      id: 'att-1',
      clockInAt: new Date(`${YESTERDAY}T09:00:00.000Z`),
      clockOutAt: null,
      deletedAt: null,
    } as never);
    prisma.attendanceRecord.update.mockResolvedValue({ id: 'att-1' } as never);
    prisma.attendanceCorrection.update.mockResolvedValue({
      ...makeCorrection(),
      status: 'APPROVED',
    } as never);
    prisma.auditLog.create.mockResolvedValue({} as never);
    prisma.user.findUnique.mockResolvedValue({ fullName: 'HR' } as never);

    const updated = await service.decide(hr, 'corr-1', { action: 'APPROVE' });
    expect(updated.status).toBe('APPROVED');
    expect(prisma.attendanceRecord.update).toHaveBeenCalledTimes(1);
    const updateArg = prisma.attendanceRecord.update.mock.calls[0]?.[0].data;
    if (!updateArg) throw new Error('update was not invoked');
    expect(updateArg.clockOutAt).toEqual(new Date(`${YESTERDAY}T18:00:00.000Z`));
    // Sentinel geo attached.
    expect(updateArg.clockOutAccuracyM).toBe(0);
  });

  it('CONFLICT_CLOCK_IN when APPROVE would overwrite a non-null existing punch', async () => {
    const { service, prisma } = setup();
    prisma.attendanceCorrection.findFirst.mockResolvedValue(makeCorrection() as never);
    prisma.company.findFirst.mockResolvedValue({ payrollLockedUntil: null } as never);
    prisma.attendanceRecord.findFirst.mockResolvedValue({
      id: 'att-1',
      clockInAt: new Date(`${YESTERDAY}T07:00:00.000Z`),
      clockOutAt: null,
      deletedAt: null,
    } as never);

    await expect(service.decide(hr, 'corr-1', { action: 'APPROVE' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects a decide inside a locked payroll period for HR (PAYROLL_LOCKED)', async () => {
    const { service, prisma } = setup();
    prisma.attendanceCorrection.findFirst.mockResolvedValue(makeCorrection() as never);
    prisma.company.findFirst.mockResolvedValue({
      payrollLockedUntil: YESTERDAY_DATE,
    } as never);

    await expect(service.decide(hr, 'corr-1', { action: 'APPROVE' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('allows SUPER_ADMIN to decide inside a locked period', async () => {
    const { service, prisma } = setup();
    prisma.attendanceCorrection.findFirst.mockResolvedValue(makeCorrection() as never);
    prisma.company.findFirst.mockResolvedValue({
      payrollLockedUntil: YESTERDAY_DATE,
    } as never);
    prisma.attendanceCorrection.update.mockResolvedValue({
      ...makeCorrection(),
      status: 'REJECTED',
    } as never);
    prisma.auditLog.create.mockResolvedValue({} as never);
    prisma.user.findUnique.mockResolvedValue({ fullName: 'SA' } as never);

    const updated = await service.decide(superAdmin, 'corr-1', {
      action: 'REJECT',
      note: 'stale',
    });
    expect(updated.status).toBe('REJECTED');
  });

  it('rejects a decide on a non-existent correction with NOT_FOUND', async () => {
    const { service, prisma } = setup();
    prisma.attendanceCorrection.findFirst.mockResolvedValue(null);
    await expect(service.decide(hr, 'missing', { action: 'APPROVE' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

describe('AttendanceCorrectionService.cancel', () => {
  it('owner may cancel their own PENDING correction', async () => {
    const { service, prisma } = setup();
    prisma.attendanceCorrection.findFirst.mockResolvedValue(makeCorrection() as never);
    prisma.company.findFirst.mockResolvedValue({ payrollLockedUntil: null } as never);
    prisma.attendanceCorrection.update.mockResolvedValue({
      ...makeCorrection(),
      status: 'CANCELLED',
    } as never);
    prisma.auditLog.create.mockResolvedValue({} as never);
    const updated = await service.cancel(employee, 'corr-1');
    expect(updated.status).toBe('CANCELLED');
  });

  it('rejects a non-owner cancel with FORBIDDEN', async () => {
    const { service, prisma } = setup();
    prisma.attendanceCorrection.findFirst.mockResolvedValue(
      makeCorrection({ userId: 'other-user' }) as never,
    );
    prisma.company.findFirst.mockResolvedValue({ payrollLockedUntil: null } as never);
    await expect(service.cancel(supervisor, 'corr-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a cancel inside a locked period for the owner', async () => {
    const { service, prisma } = setup();
    prisma.attendanceCorrection.findFirst.mockResolvedValue(makeCorrection() as never);
    prisma.company.findFirst.mockResolvedValue({
      payrollLockedUntil: YESTERDAY_DATE,
    } as never);
    await expect(service.cancel(employee, 'corr-1')).rejects.toBeInstanceOf(ConflictException);
  });
});

// ---------------------------------------------------------------------------
// listPendingApprovals
// ---------------------------------------------------------------------------

describe('AttendanceCorrectionService.listPendingApprovals', () => {
  it('forbids EMPLOYEE actors', async () => {
    const { service } = setup();
    await expect(service.listPendingApprovals(employee)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('scopes SUPERVISOR queries to their direct reports', async () => {
    const { service, prisma } = setup();
    prisma.attendanceCorrection.findMany.mockResolvedValue([] as never);
    await service.listPendingApprovals(supervisor);
    const where = prisma.attendanceCorrection.findMany.mock.calls[0]?.[0]?.where as
      { user?: { supervisorId?: string } } | undefined;
    expect(where?.user?.supervisorId).toBe(supervisor.id);
  });

  it('does NOT restrict user for HR / SUPER_ADMIN', async () => {
    const { service, prisma } = setup();
    prisma.attendanceCorrection.findMany.mockResolvedValue([] as never);
    await service.listPendingApprovals(hr);
    const where = prisma.attendanceCorrection.findMany.mock.calls[0]?.[0]?.where as
      { user?: unknown } | undefined;
    expect(where?.user).toBeUndefined();
  });
});
