import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { PrismaService } from '../prisma/prisma.service';

import { OvertimeCompletionService } from './overtime-completion.service';

function setup(): {
  service: OvertimeCompletionService;
  prisma: DeepMockProxy<PrismaService>;
} {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  const notifications = {
    createOne: jest.fn(async () => undefined),
    createMany: jest.fn(async () => undefined),
  } as unknown as ConstructorParameters<typeof OvertimeCompletionService>[1];
  return { service: new OvertimeCompletionService(prisma, notifications), prisma };
}

const NOW = new Date('2026-08-10T02:00:00Z');
const WORK_DATE = new Date('2026-08-01T00:00:00Z'); // > grace(2) days before NOW

function makeCandidate(overrides: Partial<{
  id: string;
  status: string;
  workDate: Date;
  graceDays: number;
  userId: string;
  payrollLockedUntil: Date | null;
}> = {}) {
  return {
    id: overrides.id ?? 'ot-1',
    companyId: 'co-1',
    userId: overrides.userId ?? 'u-1',
    workDate: overrides.workDate ?? WORK_DATE,
    hours: { toString: () => '3' } as unknown as ReturnType<
      typeof toDecimal
    >,
    status: overrides.status ?? 'APPROVED',
    company: {
      overtimeCompleteGraceDays: overrides.graceDays ?? 2,
      payrollLockedUntil:
        'payrollLockedUntil' in overrides ? overrides.payrollLockedUntil : null,
    },
    user: { email: 'emp@a.test', fullName: 'Employee' },
  };
}

// Tiny local helper so the shape above stays typed without pulling in the
// Prisma Decimal type from the runtime package (spec is unit-only).
function toDecimal(): { toString: () => string } {
  return { toString: () => '0' };
}

function makeAttendance(overrides: Partial<{ clockInAt: Date | null; clockOutAt: Date | null; deletedAt: Date | null }> = {}) {
  // Note: `??` would treat an explicit `null` override as "missing" and fall
  // back to the default. Use `in` checks so callers can force nullability.
  return {
    clockInAt: 'clockInAt' in overrides ? overrides.clockInAt : new Date('2026-08-01T09:00:00Z'),
    clockOutAt: 'clockOutAt' in overrides ? overrides.clockOutAt : new Date('2026-08-01T18:30:00Z'),
    deletedAt: 'deletedAt' in overrides ? overrides.deletedAt : null,
  };
}

describe('OvertimeCompletionService.runCompletion', () => {
  it('promotes an eligible row and records completedAt', async () => {
    const { service, prisma } = setup();
    prisma.overtimeRequest.findMany.mockResolvedValueOnce([makeCandidate()] as never);
    prisma.attendanceRecord.findFirst.mockResolvedValueOnce(makeAttendance() as never);
    prisma.overtimeRequest.update.mockResolvedValueOnce({} as never);

    const res = await service.runCompletion({ now: NOW });

    expect(res.scanned).toBe(1);
    expect(res.completed).toBe(1);
    expect(res.skipped).toEqual({});
    expect(prisma.overtimeRequest.update).toHaveBeenCalledWith({
      where: { id: 'ot-1' },
      data: { status: 'COMPLETED', completedAt: NOW },
    });
  });

  it('skips a row where attendance is missing', async () => {
    const { service, prisma } = setup();
    prisma.overtimeRequest.findMany.mockResolvedValueOnce([makeCandidate()] as never);
    prisma.attendanceRecord.findFirst.mockResolvedValueOnce(null);

    const res = await service.runCompletion({ now: NOW });

    expect(res.completed).toBe(0);
    expect(res.skipped).toEqual({ NO_ATTENDANCE: 1 });
    expect(prisma.overtimeRequest.update).not.toHaveBeenCalled();
  });

  it('skips a row where the user did not clock out', async () => {
    const { service, prisma } = setup();
    prisma.overtimeRequest.findMany.mockResolvedValueOnce([makeCandidate()] as never);
    prisma.attendanceRecord.findFirst.mockResolvedValueOnce(
      makeAttendance({ clockOutAt: null }) as never,
    );

    const res = await service.runCompletion({ now: NOW });

    expect(res.skipped).toEqual({ INCOMPLETE_ATTENDANCE: 1 });
  });

  it('skips a row still inside the grace window', async () => {
    const { service, prisma } = setup();
    // workDate = 2026-08-09, grace = 2 → earliest complete on 2026-08-12.
    prisma.overtimeRequest.findMany.mockResolvedValueOnce([
      makeCandidate({ workDate: new Date('2026-08-09T00:00:00Z') }),
    ] as never);
    prisma.attendanceRecord.findFirst.mockResolvedValueOnce(makeAttendance() as never);

    const res = await service.runCompletion({ now: NOW }); // now = 2026-08-10

    expect(res.completed).toBe(0);
    expect(res.skipped).toEqual({ GRACE_NOT_MET: 1 });
  });

  it('continues on a failed promotion and records the reason', async () => {
    const { service, prisma } = setup();
    prisma.overtimeRequest.findMany.mockResolvedValueOnce([
      makeCandidate({ id: 'good' }),
      makeCandidate({ id: 'bad', userId: 'u-2' }),
    ] as never);
    prisma.attendanceRecord.findFirst.mockResolvedValue(makeAttendance() as never);
    prisma.overtimeRequest.update
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error('DB write conflict'));

    const res = await service.runCompletion({ now: NOW });

    expect(res.scanned).toBe(2);
    expect(res.completed).toBe(1);
    expect(res.skipped).toEqual({ PROMOTE_FAILED: 1 });
  });

  it('is idempotent — an ALREADY_COMPLETED row (shouldn\u2019t appear in query, but tests defense-in-depth) is skipped', async () => {
    const { service, prisma } = setup();
    prisma.overtimeRequest.findMany.mockResolvedValueOnce([
      makeCandidate({ status: 'COMPLETED' }),
    ] as never);
    prisma.attendanceRecord.findFirst.mockResolvedValueOnce(makeAttendance() as never);

    const res = await service.runCompletion({ now: NOW });

    expect(res.skipped).toEqual({ ALREADY_COMPLETED: 1 });
  });

  it('accepts a companyId scope filter', async () => {
    const { service, prisma } = setup();
    prisma.overtimeRequest.findMany.mockResolvedValueOnce([] as never);

    await service.runCompletion({ companyId: 'co-42', now: NOW });

    expect(prisma.overtimeRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'co-42', status: 'APPROVED' }),
      }),
    );
  });

  describe('payroll cutoff', () => {
    it('skips a candidate whose workDate is inside the frozen period', async () => {
      const { service, prisma } = setup();
      // workDate = 2026-08-01; cutoff = 2026-08-05 (inclusive) → frozen.
      prisma.overtimeRequest.findMany.mockResolvedValueOnce([
        makeCandidate({
          payrollLockedUntil: new Date('2026-08-05T00:00:00Z'),
        }),
      ] as never);

      const res = await service.runCompletion({ now: NOW });

      expect(res.completed).toBe(0);
      expect(res.skipped).toEqual({ PAYROLL_LOCKED: 1 });
      // The short-circuit occurs BEFORE the attendance query. This assertion
      // guards against regressions that would waste a round-trip per row.
      expect(prisma.attendanceRecord.findFirst).not.toHaveBeenCalled();
      expect(prisma.overtimeRequest.update).not.toHaveBeenCalled();
    });

    it('promotes when the cutoff is strictly before the workDate', async () => {
      const { service, prisma } = setup();
      // workDate = 2026-08-01; cutoff = 2026-07-31 (day earlier) → unfrozen.
      prisma.overtimeRequest.findMany.mockResolvedValueOnce([
        makeCandidate({
          payrollLockedUntil: new Date('2026-07-31T00:00:00Z'),
        }),
      ] as never);
      prisma.attendanceRecord.findFirst.mockResolvedValueOnce(makeAttendance() as never);
      prisma.overtimeRequest.update.mockResolvedValueOnce({} as never);

      const res = await service.runCompletion({ now: NOW });

      expect(res.completed).toBe(1);
      expect(res.skipped).toEqual({});
    });

    it('is a no-op when payrollLockedUntil is null', async () => {
      const { service, prisma } = setup();
      prisma.overtimeRequest.findMany.mockResolvedValueOnce([
        makeCandidate({ payrollLockedUntil: null }),
      ] as never);
      prisma.attendanceRecord.findFirst.mockResolvedValueOnce(makeAttendance() as never);
      prisma.overtimeRequest.update.mockResolvedValueOnce({} as never);

      const res = await service.runCompletion({ now: NOW });

      expect(res.completed).toBe(1);
    });
  });
});
