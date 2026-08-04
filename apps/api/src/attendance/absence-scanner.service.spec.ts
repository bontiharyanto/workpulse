import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';

import { AbsenceScannerService } from './absence-scanner.service';

function setup(): {
  service: AbsenceScannerService;
  prisma: DeepMockProxy<PrismaService>;
  notifications: DeepMockProxy<NotificationService>;
} {
  const prisma = mockDeep<PrismaService>();
  const notifications = mockDeep<NotificationService>();
  mockReset(prisma);
  mockReset(notifications);
  // Sensible defaults so unrelated Prisma methods return an awaitable value.
  prisma.company.update.mockResolvedValue({} as never);
  prisma.company.findMany.mockResolvedValue([] as never);
  prisma.user.findMany.mockResolvedValue([] as never);
  prisma.attendanceRecord.findMany.mockResolvedValue([] as never);
  prisma.absenceRecord.findMany.mockResolvedValue([] as never);
  prisma.absenceRecord.create.mockResolvedValue({} as never);
  prisma.leaveRequest.findMany.mockResolvedValue([] as never);
  prisma.holiday.findFirst.mockResolvedValue(null as never);
  notifications.createOne.mockResolvedValue(undefined as never);
  const service = new AbsenceScannerService(prisma, notifications);
  return { service, prisma, notifications };
}

/** Stub `Promise.all([roster, holiday, attendance, absences, leaves])` responses. */
function stubScanContext(
  s: ReturnType<typeof setup>,
  args: {
    roster: Array<{
      id: string;
      email: string;
      fullName: string;
      hiredAt: Date;
      employmentStatus: string;
      supervisor: null | { id: string; email: string };
      shiftAssignments: Array<{ id: string }>;
    }>;
    isHoliday?: boolean;
    attendedIds?: string[];
    absentIds?: string[];
    onLeaveIds?: string[];
  },
) {
  s.prisma.user.findMany.mockResolvedValue(args.roster as never);
  s.prisma.holiday.findFirst.mockResolvedValue(
    args.isHoliday ? ({ id: 'holiday-1' } as never) : null,
  );
  s.prisma.attendanceRecord.findMany.mockResolvedValue(
    (args.attendedIds ?? []).map((userId) => ({ userId })) as never,
  );
  s.prisma.absenceRecord.findMany.mockResolvedValue(
    (args.absentIds ?? []).map((userId) => ({ userId })) as never,
  );
  s.prisma.leaveRequest.findMany.mockResolvedValue(
    (args.onLeaveIds ?? []).map((userId) => ({ userId })) as never,
  );
}

function makeMember(overrides: Partial<{
  id: string;
  email: string;
  fullName: string;
  hiredAt: Date;
  employmentStatus: string;
  supervisor: null | { id: string; email: string };
  hasShift: boolean;
}> = {}) {
  return {
    id: overrides.id ?? 'user-1',
    email: overrides.email ?? 'u1@x.test',
    fullName: overrides.fullName ?? 'Ana',
    hiredAt: overrides.hiredAt ?? new Date('2020-01-01T00:00:00Z'),
    employmentStatus: overrides.employmentStatus ?? 'ACTIVE',
    supervisor: overrides.supervisor ?? null,
    shiftAssignments: overrides.hasShift === false ? [] : [{ id: 's1' }],
  };
}

describe('AbsenceScannerService.scanCompany', () => {
  it('short-circuits on weekend dates without hitting the DB', async () => {
    const s = setup();
    // 2026-08-01 is a Saturday.
    const result = await s.service.scanCompany('c1', ['2026-08-01']);
    expect(result.marked).toBe(0);
    expect(s.prisma.user.findMany).not.toHaveBeenCalled();
    expect(s.prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1' } }),
    );
  });

  it('creates AbsenceRecord + advances cursor when an ACTIVE user misses a working day', async () => {
    const s = setup();
    stubScanContext(s, {
      roster: [makeMember({ id: 'u1', supervisor: { id: 'sup1', email: 's1@x.test' } })],
    });
    s.prisma.absenceRecord.create.mockResolvedValue({} as never);
    s.notifications.createOne.mockResolvedValue(undefined as never);

    const result = await s.service.scanCompany('c1', ['2026-08-05']);

    expect(result.marked).toBe(1);
    expect(s.prisma.absenceRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'c1',
          userId: 'u1',
          source: 'AUTO_SCHEDULER',
        }),
      }),
    );
    // Cursor advanced
    expect(s.prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({ lastAbsentScanDate: expect.any(Date) }),
      }),
    );
    // Notifications: employee + supervisor
    expect(s.notifications.createOne).toHaveBeenCalledTimes(2);
    const [empCall, supCall] = s.notifications.createOne.mock.calls;
    if (!empCall || !supCall) throw new Error('notifications not called');
    expect(empCall[0]?.recipientId).toBe('u1');
    expect(supCall[0]?.recipientId).toBe('sup1');
  });

  it('skips employees who clocked in that day', async () => {
    const s = setup();
    stubScanContext(s, {
      roster: [makeMember({ id: 'u1' })],
      attendedIds: ['u1'],
    });

    const result = await s.service.scanCompany('c1', ['2026-08-05']);
    expect(result.marked).toBe(0);
    expect(result.skipped.CLOCKED_IN).toBe(1);
    expect(s.prisma.absenceRecord.create).not.toHaveBeenCalled();
  });

  it('skips employees on approved leave', async () => {
    const s = setup();
    stubScanContext(s, {
      roster: [makeMember({ id: 'u1' })],
      onLeaveIds: ['u1'],
    });

    const result = await s.service.scanCompany('c1', ['2026-08-05']);
    expect(result.marked).toBe(0);
    expect(result.skipped.ON_APPROVED_LEAVE).toBe(1);
  });

  it('skips employees on a company holiday for the entire tenant', async () => {
    const s = setup();
    stubScanContext(s, {
      roster: [makeMember({ id: 'u1' }), makeMember({ id: 'u2' })],
      isHoliday: true,
    });

    const result = await s.service.scanCompany('c1', ['2026-08-05']);
    expect(result.marked).toBe(0);
    expect(result.skipped.HOLIDAY).toBe(2);
  });

  it('skips employees without a shift assignment covering the date', async () => {
    const s = setup();
    stubScanContext(s, {
      roster: [makeMember({ id: 'u1', hasShift: false })],
    });

    const result = await s.service.scanCompany('c1', ['2026-08-05']);
    expect(result.marked).toBe(0);
    expect(result.skipped.NO_SHIFT_ASSIGNMENT).toBe(1);
  });

  it('is idempotent — an existing AbsenceRecord causes ALREADY_MARKED', async () => {
    const s = setup();
    stubScanContext(s, {
      roster: [makeMember({ id: 'u1' })],
      absentIds: ['u1'],
    });

    const result = await s.service.scanCompany('c1', ['2026-08-05']);
    expect(result.marked).toBe(0);
    expect(result.skipped.ALREADY_MARKED).toBe(1);
    expect(s.prisma.absenceRecord.create).not.toHaveBeenCalled();
  });

  it('treats P2002 unique-violation on create as ALREADY_MARKED (concurrent scanner)', async () => {
    const s = setup();
    stubScanContext(s, {
      roster: [makeMember({ id: 'u1' })],
    });
    s.prisma.absenceRecord.create.mockRejectedValue(
      Object.assign(new Error('unique'), { code: 'P2002' }),
    );

    const result = await s.service.scanCompany('c1', ['2026-08-05']);
    expect(result.marked).toBe(0);
    expect(result.skipped.ALREADY_MARKED).toBe(1);
  });

  it('processes multiple dates in a single call and reports the cursor of the LAST processed', async () => {
    const s = setup();
    stubScanContext(s, {
      roster: [makeMember({ id: 'u1' })],
    });
    s.prisma.absenceRecord.create.mockResolvedValue({} as never);

    // 2026-08-04 (Tue), 2026-08-05 (Wed) — both weekdays
    const result = await s.service.scanCompany('c1', ['2026-08-04', '2026-08-05']);
    expect(result.marked).toBe(2);
    expect(result.scannedDates).toBe(2);
    // cursor set to LAST successful date
    const updateCall = s.prisma.company.update.mock.calls[0]?.[0];
    expect(updateCall?.data.lastAbsentScanDate).toEqual(new Date('2026-08-05T00:00:00Z'));
  });

  it('stops advancing the cursor after an error, so the failed date is retried next run', async () => {
    const s = setup();
    // First date succeeds, second date's user.findMany throws.
    s.prisma.holiday.findFirst.mockResolvedValue(null);
    s.prisma.attendanceRecord.findMany.mockResolvedValue([] as never);
    s.prisma.absenceRecord.findMany.mockResolvedValue([] as never);
    s.prisma.leaveRequest.findMany.mockResolvedValue([] as never);
    s.prisma.absenceRecord.create.mockResolvedValue({} as never);
    s.prisma.user.findMany
      .mockResolvedValueOnce([makeMember({ id: 'u1' })] as never)
      .mockRejectedValueOnce(new Error('db kaput'));

    const result = await s.service.scanCompany('c1', ['2026-08-04', '2026-08-05']);
    expect(result.marked).toBe(1);
    expect(result.skipped.ERROR).toBe(1);
    // Cursor should be `2026-08-04` (last SUCCESS), not `2026-08-05`
    const updateCall = s.prisma.company.update.mock.calls[0]?.[0];
    expect(updateCall?.data.lastAbsentScanDate).toEqual(new Date('2026-08-04T00:00:00Z'));
  });
});

describe('AbsenceScannerService.runAll', () => {
  it('skips tenants whose target date is still inside the grace window', async () => {
    const s = setup();
    // 06:00 Asia/Jakarta with grace=8 → resolveTargetDate returns null
    const now = new Date('2026-08-05T23:00:00Z'); // 06:00 next day Jakarta
    s.prisma.company.findMany.mockResolvedValue([
      {
        id: 'c1',
        timezone: 'Asia/Jakarta',
        absentScanGraceHours: 8,
        lastAbsentScanDate: null,
      },
    ] as never);

    const result = await s.service.runAll({ now });
    expect(result.scannedCompanies).toBe(0);
    expect(s.prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('skips tenants whose cursor is already at the target date', async () => {
    const s = setup();
    const now = new Date('2026-08-02T09:00:00Z'); // 16:00 Jakarta, day is 2026-08-02
    s.prisma.company.findMany.mockResolvedValue([
      {
        id: 'c1',
        timezone: 'Asia/Jakarta',
        absentScanGraceHours: 6,
        // Already scanned 2026-08-01 (which is `now`'s target)
        lastAbsentScanDate: new Date('2026-08-01T00:00:00Z'),
        payrollLockedUntil: null,
      },
    ] as never);

    const result = await s.service.runAll({ now });
    expect(result.scannedCompanies).toBe(0);
  });
});

describe('AbsenceScannerService — payroll cutoff', () => {
  it('skips dates inside the frozen period without loading the roster', async () => {
    const s = setup();
    // Wednesday 2026-07-29 is inside a payroll lock through 2026-07-31.
    const result = await s.service.scanCompany(
      'c1',
      ['2026-07-29'],
      new Date('2026-07-31T00:00:00Z'),
    );
    expect(result.marked).toBe(0);
    expect(result.skipped.PAYROLL_LOCKED).toBe(1);
    // Payroll lock short-circuits before the roster load — assert no
    // roster query was issued.
    expect(s.prisma.user.findMany).not.toHaveBeenCalled();
    // Cursor still advances so we don't retry every hour.
    expect(s.prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1' } }),
    );
  });

  it('advances past locked dates AND still processes later unlocked dates in the same batch', async () => {
    const s = setup();
    // 07-29 (Wed, locked), 07-30 (Thu, locked), 08-03 (Mon, unlocked).
    // Roster + no clock-ins on the unlocked date → 1 marked.
    stubScanContext(s, {
      roster: [makeMember({ id: 'u1' })],
    });
    const result = await s.service.scanCompany(
      'c1',
      ['2026-07-29', '2026-07-30', '2026-08-03'],
      new Date('2026-07-31T00:00:00Z'),
    );
    expect(result.skipped.PAYROLL_LOCKED).toBe(2);
    // 08-03 is unlocked → the classifier runs → an absence is inserted.
    expect(result.marked).toBe(1);
    // Cursor advances to the last processed date (08-03), not the last
    // locked date.
    const updateCall = s.prisma.company.update.mock.calls[0]?.[0] as
      | { data: { lastAbsentScanDate: Date } }
      | undefined;
    expect(updateCall?.data.lastAbsentScanDate.toISOString().slice(0, 10)).toBe(
      '2026-08-03',
    );
  });

  it('is a no-op when payrollLockedUntil is null (no cutoff configured)', async () => {
    const s = setup();
    stubScanContext(s, { roster: [makeMember({ id: 'u1' })] });
    const result = await s.service.scanCompany('c1', ['2026-08-03'], null);
    expect(result.skipped.PAYROLL_LOCKED).toBe(0);
    expect(result.marked).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// resetCursor + scanCompanyById (Fase 21 — ADR-0010 follow-up)
// ---------------------------------------------------------------------------

/**
 * Helper: rewire the mock $transaction into an execute-the-callback shim
 * so audit-log writes flow through. The base setup doesn't do this
 * because most existing tests never enter a transaction — reset-cursor
 * does.
 */
function withTransaction(s: ReturnType<typeof setup>): void {
  (s.prisma.$transaction as unknown as jest.Mock).mockImplementation(
    async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: PrismaService) => unknown)(s.prisma);
      }
      return Promise.all(arg as Promise<unknown>[]);
    },
  );
  s.prisma.auditLog.create.mockResolvedValue({} as never);
}

describe('AbsenceScannerService.resetCursor', () => {
  it('clears lastAbsentScanDate and writes an audit log entry', async () => {
    const s = setup();
    withTransaction(s);
    s.prisma.company.findFirst.mockResolvedValue({
      id: 'c1',
      lastAbsentScanDate: new Date('2026-07-31T00:00:00Z'),
    } as never);

    const result = await s.service.resetCursor('c1', {
      actor: { id: 'super-admin-1' },
    });

    expect(result).toEqual({
      before: new Date('2026-07-31T00:00:00Z'),
      after: null,
      rescanTriggered: false,
    });
    const updateCall = s.prisma.company.update.mock.calls[0]?.[0];
    expect(updateCall?.where).toEqual({ id: 'c1' });
    expect(updateCall?.data.lastAbsentScanDate).toBeNull();
    const auditCall = s.prisma.auditLog.create.mock.calls[0]?.[0];
    expect(auditCall?.data.action).toBe('SCANNER_CURSOR_RESET');
    expect(auditCall?.data.entityId).toBe('c1');
    expect(auditCall?.data.actorId).toBe('super-admin-1');
  });

  it('returns before=null when the cursor was already null (never scanned)', async () => {
    const s = setup();
    withTransaction(s);
    s.prisma.company.findFirst.mockResolvedValue({
      id: 'c1',
      lastAbsentScanDate: null,
    } as never);

    const result = await s.service.resetCursor('c1', {
      actor: { id: 'sa' },
    });
    expect(result.before).toBeNull();
    expect(result.after).toBeNull();
    expect(result.rescanTriggered).toBe(false);
  });

  it('skips the audit write when no actor is supplied (test-mode escape hatch)', async () => {
    const s = setup();
    withTransaction(s);
    s.prisma.company.findFirst.mockResolvedValue({
      id: 'c1',
      lastAbsentScanDate: null,
    } as never);
    await s.service.resetCursor('c1', {});
    expect(s.prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('throws when the tenant is missing / soft-deleted', async () => {
    const s = setup();
    s.prisma.company.findFirst.mockResolvedValue(null as never);
    await expect(s.service.resetCursor('c-missing', {})).rejects.toThrow(
      /COMPANY_NOT_FOUND/,
    );
  });

  it('with triggerRescan=true, invokes scanCompanyById after the reset', async () => {
    const s = setup();
    withTransaction(s);
    // First findFirst → resetCursor lookup. Second → scanCompanyById lookup.
    s.prisma.company.findFirst
      .mockResolvedValueOnce({
        id: 'c1',
        lastAbsentScanDate: new Date('2026-07-31T00:00:00Z'),
      } as never)
      .mockResolvedValueOnce({
        id: 'c1',
        timezone: 'Asia/Jakarta',
        absentScanGraceHours: 6,
        lastAbsentScanDate: null, // just reset
        payrollLockedUntil: null,
      } as never);
    // Roster empty → no work to do; scanCompany returns marked=0.
    stubScanContext(s, { roster: [] });

    const result = await s.service.resetCursor('c1', {
      triggerRescan: true,
      // `now` chosen so the target date resolves (16:00 Jakarta → 2026-08-01).
      now: new Date('2026-08-02T09:00:00Z'),
      actor: { id: 'sa' },
    });

    expect(result.rescanTriggered).toBe(true);
    expect(result.rescanResult).toBeDefined();
    expect(result.rescanResult?.companyId).toBe('c1');
  });
});

describe('AbsenceScannerService.scanCompanyById', () => {
  it('returns an empty result when no target date can be resolved yet', async () => {
    const s = setup();
    s.prisma.company.findFirst.mockResolvedValue({
      id: 'c1',
      timezone: 'Asia/Jakarta',
      absentScanGraceHours: 6,
      lastAbsentScanDate: null,
      payrollLockedUntil: null,
    } as never);
    // 00:30 Jakarta on 2026-08-02 → target for yesterday is not yet
    // beyond the grace window → resolveTargetDate returns null.
    const result = await s.service.scanCompanyById(
      'c1',
      new Date('2026-08-01T17:30:00Z'),
    );
    expect(result.scannedDates).toBe(0);
    expect(result.marked).toBe(0);
  });

  it('throws COMPANY_NOT_FOUND when the tenant is missing', async () => {
    const s = setup();
    s.prisma.company.findFirst.mockResolvedValue(null as never);
    await expect(
      s.service.scanCompanyById('c-missing', new Date()),
    ).rejects.toThrow(/COMPANY_NOT_FOUND/);
  });
});
