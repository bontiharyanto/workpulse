import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { AttendanceService } from './attendance.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';

type PrismaMock = DeepMockProxy<PrismaService>;
type NotificationsMock = DeepMockProxy<NotificationService>;

function makeNotifications(): NotificationsMock {
  const notifications = mockDeep<NotificationService>();
  mockReset(notifications);
  notifications.createOne.mockResolvedValue(undefined as never);
  return notifications;
}

const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'e@a.test',
  companyId: 'company-1',
  departmentId: 'dep-1',
  role: 'EMPLOYEE',
};

const jakartaHQ = { latitude: -6.2088, longitude: 106.8456 };

function buildAssignment(
  overrides: Partial<{
    geofenceRadius: number;
    maxAccuracyMeters: number | null;
    allowedSsids: string[];
  }> = {},
) {
  const radius = overrides.geofenceRadius ?? 150;
  const maxAccuracyMeters = overrides.maxAccuracyMeters ?? null;
  const allowedSsids = overrides.allowedSsids ?? [];
  return {
    id: 'ua-1',
    userId: user.id,
    shiftId: 'shift-1',
    effectiveFrom: new Date('2024-01-01'),
    effectiveTo: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    shift: {
      id: 'shift-1',
      companyId: user.companyId,
      geofenceId: 'geo-1',
      name: 'Regular',
      type: 'STATIC' as const,
      startTime: '09:00',
      endTime: '18:00',
      graceMinutes: 15,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      geofence: {
        id: 'geo-1',
        companyId: user.companyId,
        name: 'HQ',
        latitude: new Prisma.Decimal(jakartaHQ.latitude),
        longitude: new Prisma.Decimal(jakartaHQ.longitude),
        radiusMeters: radius,
        maxAccuracyMeters,
        allowedSsids,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
      company: {
        id: user.companyId,
        name: 'Acme',
        slug: 'acme',
        timezone: 'Asia/Jakarta',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    },
  };
}

describe('AttendanceService.clockIn', () => {
  let prisma: PrismaMock;
  let service: AttendanceService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    mockReset(prisma);
    service = new AttendanceService(prisma, makeNotifications());
  });

  it('throws NotFoundException when the user has no active shift', async () => {
    prisma.userShiftAssignment.findFirst.mockResolvedValue(null);
    await expect(
      service.clockIn(user, {
        latitude: jakartaHQ.latitude,
        longitude: jakartaHQ.longitude,
        accuracyMeters: 10,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws ForbiddenException with code OUTSIDE_GEOFENCE when coords are far away', async () => {
    prisma.userShiftAssignment.findFirst.mockResolvedValue(buildAssignment() as never);

    await expect(
      service.clockIn(user, {
        latitude: jakartaHQ.latitude + 0.01,
        longitude: jakartaHQ.longitude,
        accuracyMeters: 10,
      }),
    ).rejects.toMatchObject({
      name: 'ForbiddenException',
      message: 'OUTSIDE_GEOFENCE',
    });
    expect(prisma.attendanceRecord.create).not.toHaveBeenCalled();
  });

  it('throws ConflictException when already clocked in today', async () => {
    prisma.userShiftAssignment.findFirst.mockResolvedValue(buildAssignment() as never);
    prisma.attendanceRecord.findUnique.mockResolvedValue({ id: 'existing' } as never);

    await expect(
      service.clockIn(user, {
        latitude: jakartaHQ.latitude,
        longitude: jakartaHQ.longitude,
        accuracyMeters: 5,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('runs the full happy path in a transaction', async () => {
    prisma.userShiftAssignment.findFirst.mockResolvedValue(buildAssignment() as never);
    prisma.attendanceRecord.findUnique.mockResolvedValue(null);

    const created = {
      id: 'att-1',
      companyId: user.companyId,
      userId: user.id,
      shiftId: 'shift-1',
      workDate: new Date(),
      clockInAt: new Date(),
      clockOutAt: null,
      clockInLatitude: new Prisma.Decimal(jakartaHQ.latitude),
      clockInLongitude: new Prisma.Decimal(jakartaHQ.longitude),
      clockInAccuracyM: 5,
      clockOutLatitude: null,
      clockOutLongitude: null,
      clockOutAccuracyM: null,
      status: 'ON_TIME' as const,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      note: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    prisma.attendanceRecord.create.mockResolvedValue(created as never);
    prisma.attendanceEvent.create.mockResolvedValue({} as never);
    prisma.auditLog.create.mockResolvedValue({} as never);

    type TxCallback = (tx: PrismaService) => Promise<unknown>;
    prisma.$transaction.mockImplementation(((cb: TxCallback) => cb(prisma)) as never);

    const result = await service.clockIn(user, {
      latitude: jakartaHQ.latitude,
      longitude: jakartaHQ.longitude,
      accuracyMeters: 5,
    });

    expect(result.id).toBe('att-1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.attendanceRecord.create).toHaveBeenCalledTimes(1);
    expect(prisma.attendanceEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'ATTENDANCE_CLOCK_IN', entityId: 'att-1' }),
      }),
    );
  });

  it('rejects requests from another tenant', async () => {
    const assignment = buildAssignment();
    assignment.shift.companyId = 'other-company';
    prisma.userShiftAssignment.findFirst.mockResolvedValue(assignment as never);

    await expect(
      service.clockIn(user, {
        latitude: jakartaHQ.latitude,
        longitude: jakartaHQ.longitude,
        accuracyMeters: 5,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects with WEAK_GPS_ACCURACY when accuracy exceeds the geofence budget', async () => {
    prisma.userShiftAssignment.findFirst.mockResolvedValue(
      buildAssignment({ maxAccuracyMeters: 50 }) as never,
    );

    try {
      await service.clockIn(user, {
        latitude: jakartaHQ.latitude,
        longitude: jakartaHQ.longitude,
        accuracyMeters: 200,
      });
      fail('expected clockIn to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const payload = (err as ForbiddenException).getResponse() as Record<string, unknown>;
      expect(payload.code).toBe('WEAK_GPS_ACCURACY');
    }
    expect(prisma.attendanceRecord.create).not.toHaveBeenCalled();
  });

  it('accepts a good accuracy reading when a budget is configured', async () => {
    prisma.userShiftAssignment.findFirst.mockResolvedValue(
      buildAssignment({ maxAccuracyMeters: 50 }) as never,
    );
    prisma.attendanceRecord.findUnique.mockResolvedValue(null as never);
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb !== 'function') throw new Error('expected transactional callback');
      const tx = mockDeep<PrismaService>();
      tx.attendanceRecord.create.mockResolvedValue({ id: 'rec-1' } as never);
      tx.attendanceEvent.create.mockResolvedValue({} as never);
      tx.auditLog.create.mockResolvedValue({} as never);
      return (cb as (t: typeof tx) => Promise<unknown>)(tx);
    });

    await service.clockIn(user, {
      latitude: jakartaHQ.latitude,
      longitude: jakartaHQ.longitude,
      accuracyMeters: 20,
    });
  });

  it('lets the Wi-Fi SSID fallback bypass the distance check', async () => {
    prisma.userShiftAssignment.findFirst.mockResolvedValue(
      buildAssignment({ allowedSsids: ['OFFICE-WIFI-JKT'] }) as never,
    );
    prisma.attendanceRecord.findUnique.mockResolvedValue(null as never);
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb !== 'function') throw new Error('expected transactional callback');
      const tx = mockDeep<PrismaService>();
      tx.attendanceRecord.create.mockResolvedValue({ id: 'rec-1' } as never);
      tx.attendanceEvent.create.mockResolvedValue({} as never);
      tx.auditLog.create.mockResolvedValue({} as never);
      return (cb as (t: typeof tx) => Promise<unknown>)(tx);
    });

    // Coordinates that would normally fall OUTSIDE the fence, but the
    // client reports a whitelisted SSID.
    await service.clockIn(user, {
      latitude: jakartaHQ.latitude + 0.05,
      longitude: jakartaHQ.longitude + 0.05,
      accuracyMeters: 10,
      wifiSsid: 'OFFICE-WIFI-JKT',
    });
  });

  it('does NOT accept a non-matching SSID as fallback', async () => {
    prisma.userShiftAssignment.findFirst.mockResolvedValue(
      buildAssignment({ allowedSsids: ['OFFICE-WIFI-JKT'] }) as never,
    );

    await expect(
      service.clockIn(user, {
        latitude: jakartaHQ.latitude + 0.05,
        longitude: jakartaHQ.longitude,
        accuracyMeters: 10,
        wifiSsid: 'STARBUCKS-WIFI',
      }),
    ).rejects.toMatchObject({
      name: 'ForbiddenException',
      message: 'OUTSIDE_GEOFENCE',
    });
  });

  it('checks accuracy BEFORE the SSID fallback (spoof-safety)', async () => {
    // A client reporting the correct SSID but with garbage GPS
    // accuracy should be rejected — otherwise a device that
    // IP-geolocates could piggyback on a leaked SSID.
    prisma.userShiftAssignment.findFirst.mockResolvedValue(
      buildAssignment({
        maxAccuracyMeters: 50,
        allowedSsids: ['OFFICE-WIFI-JKT'],
      }) as never,
    );

    try {
      await service.clockIn(user, {
        latitude: jakartaHQ.latitude,
        longitude: jakartaHQ.longitude,
        accuracyMeters: 500,
        wifiSsid: 'OFFICE-WIFI-JKT',
      });
      fail('expected clockIn to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const payload = (err as ForbiddenException).getResponse() as Record<string, unknown>;
      expect(payload.code).toBe('WEAK_GPS_ACCURACY');
    }
  });
});

describe('AttendanceService.listMyHistory', () => {
  let prisma: PrismaMock;
  let service: AttendanceService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    mockReset(prisma);
    service = new AttendanceService(prisma, makeNotifications());
  });

  it('defaults to a 90-day window ending today', async () => {
    prisma.attendanceRecord.findMany.mockResolvedValue([] as never);
    await service.listMyHistory(user);

    expect(prisma.attendanceRecord.findMany).toHaveBeenCalledTimes(1);
    const arg = prisma.attendanceRecord.findMany.mock.calls[0]?.[0]!;
    const where = arg?.where as {
      workDate: { gte: Date; lte: Date };
      userId: string;
      companyId: string;
    };
    const spanDays = Math.round(
      (where.workDate.lte.getTime() - where.workDate.gte.getTime()) / 86_400_000,
    );
    expect(spanDays).toBe(89); // inclusive → 90 calendar days
    expect(where.userId).toBe(user.id);
    expect(where.companyId).toBe(user.companyId);
    expect(arg?.take).toBe(60);
  });

  it('rejects an inverted range', async () => {
    await expect(
      service.listMyHistory(user, { from: '2026-08-10', to: '2026-08-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled();
  });

  it('rejects a range wider than one year (guard against runaway queries)', async () => {
    await expect(
      service.listMyHistory(user, { from: '2020-01-01', to: '2026-08-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clamps the page size to 200 even when a caller asks for more', async () => {
    prisma.attendanceRecord.findMany.mockResolvedValue([] as never);
    await service.listMyHistory(user, { limit: 9999 });
    const arg = prisma.attendanceRecord.findMany.mock.calls[0]?.[0]!;
    expect(arg?.take).toBe(200);
  });
});

describe('AttendanceService.listTeamToday', () => {
  let prisma: PrismaMock;
  let service: AttendanceService;

  const supervisor: AuthenticatedUser = {
    id: 'sup-1',
    email: 's@a.test',
    companyId: 'company-1',
    departmentId: 'dep-1',
    role: 'SUPERVISOR',
  };

  const hr: AuthenticatedUser = { ...supervisor, id: 'hr-1', role: 'HR_MANAGER' };
  const employee: AuthenticatedUser = { ...supervisor, id: 'emp-1', role: 'EMPLOYEE' };

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    mockReset(prisma);
    service = new AttendanceService(prisma, makeNotifications());
  });

  it('rejects EMPLOYEE (only supervisors and HR can see team views)', async () => {
    await expect(service.listTeamToday(employee)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('scopes roster to direct reports when caller is SUPERVISOR', async () => {
    prisma.user.findMany.mockResolvedValue([] as never);
    await service.listTeamToday(supervisor);

    const arg = prisma.user.findMany.mock.calls[0]?.[0]!;
    const where = arg?.where as { supervisorId?: string; companyId: string };
    expect(where.supervisorId).toBe(supervisor.id);
    expect(where.companyId).toBe(supervisor.companyId);
  });

  it('does NOT scope by supervisorId when caller is HR_MANAGER', async () => {
    prisma.user.findMany.mockResolvedValue([] as never);
    await service.listTeamToday(hr);

    const arg = prisma.user.findMany.mock.calls[0]?.[0]!;
    const where = arg?.where as { supervisorId?: string };
    expect(where.supervisorId).toBeUndefined();
  });

  it('marks roster members without a record as NOT_CLOCKED_IN', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', fullName: 'Aditya', email: 'a@t.test', department: { name: 'Eng' } },
      { id: 'u2', fullName: 'Budi', email: 'b@t.test', department: null },
    ] as never);
    prisma.attendanceRecord.findMany.mockResolvedValue([] as never);
    prisma.absenceRecord.findMany.mockResolvedValue([] as never);
    prisma.leaveRequest.findMany.mockResolvedValue([] as never);

    const rows = await service.listTeamToday(supervisor);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'NOT_CLOCKED_IN')).toBe(true);
  });

  it('rejects an obviously invalid date string', async () => {
    await expect(service.listTeamToday(supervisor, { date: 'not-a-date' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('AttendanceService.getTeamSummary', () => {
  let prisma: PrismaMock;
  let service: AttendanceService;

  const supervisor: AuthenticatedUser = {
    id: 'sup-1',
    email: 's@a.test',
    companyId: 'company-1',
    departmentId: 'dep-1',
    role: 'SUPERVISOR',
  };

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    mockReset(prisma);
    service = new AttendanceService(prisma, makeNotifications());
  });

  it('defaults to a 7-day rolling window ending today', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', fullName: 'A', email: 'a@t.test', department: null },
    ] as never);
    prisma.attendanceRecord.findMany.mockResolvedValue([] as never);
    (prisma.absenceRecord.groupBy as unknown as jest.Mock).mockResolvedValue([]);

    const result = await service.getTeamSummary(supervisor);
    const arg = prisma.attendanceRecord.findMany.mock.calls[0]?.[0]!;
    const where = arg?.where as { workDate: { gte: Date; lte: Date } };
    const spanDays =
      Math.round((where.workDate.lte.getTime() - where.workDate.gte.getTime()) / 86_400_000) + 1;
    expect(spanDays).toBe(7);
    expect(result.rows).toHaveLength(1);
  });

  it('rejects a range wider than 92 days', async () => {
    await expect(
      service.getTeamSummary(supervisor, { from: '2020-01-01', to: '2026-08-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns an empty rows list when the roster is empty (no direct reports)', async () => {
    prisma.user.findMany.mockResolvedValue([] as never);
    const result = await service.getTeamSummary(supervisor);
    expect(result.rows).toEqual([]);
    expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled();
  });
});

describe('AttendanceService.getMyMonthlySummary', () => {
  let prisma: PrismaMock;
  let service: AttendanceService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    mockReset(prisma);
    service = new AttendanceService(prisma, makeNotifications());
  });

  it('rejects an out-of-range month', async () => {
    await expect(
      service.getMyMonthlySummary(user, { year: 2026, month: 13 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aggregates on-time / late / early-leave rows', async () => {
    prisma.absenceRecord.count.mockResolvedValue(0 as never);
    prisma.attendanceRecord.findMany.mockResolvedValue([
      // On-time: 8h worked
      {
        status: 'ON_TIME',
        clockInAt: new Date('2026-08-01T02:00:00Z'),
        clockOutAt: new Date('2026-08-01T10:00:00Z'),
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
      },
      // Late 15 min, worked 8h
      {
        status: 'LATE',
        clockInAt: new Date('2026-08-04T02:15:00Z'),
        clockOutAt: new Date('2026-08-04T10:15:00Z'),
        lateMinutes: 15,
        earlyLeaveMinutes: 0,
      },
      // Early leave 30 min
      {
        status: 'EARLY_LEAVE',
        clockInAt: new Date('2026-08-05T02:00:00Z'),
        clockOutAt: new Date('2026-08-05T09:30:00Z'),
        lateMinutes: 0,
        earlyLeaveMinutes: 30,
      },
    ] as never);

    const s = await service.getMyMonthlySummary(user, { year: 2026, month: 8 });

    expect(s.year).toBe(2026);
    expect(s.month).toBe(8);
    expect(s.presentDays).toBe(3);
    expect(s.onTimeDays).toBe(1);
    expect(s.lateDays).toBe(1);
    expect(s.earlyLeaveDays).toBe(1);
    expect(s.totalLateMinutes).toBe(15);
    expect(s.totalEarlyLeaveMinutes).toBe(30);
    // 8 + 8 + 7.5 = 23.5
    expect(s.totalHoursWorked).toBe(23.5);
  });

  it('scopes the DB query to the exact calendar month (UTC)', async () => {
    prisma.attendanceRecord.findMany.mockResolvedValue([] as never);
    prisma.absenceRecord.count.mockResolvedValue(0 as never);
    await service.getMyMonthlySummary(user, { year: 2026, month: 2 });
    const arg = prisma.attendanceRecord.findMany.mock.calls[0]?.[0]!;
    const where = arg?.where as { workDate: { gte: Date; lt: Date } };
    expect(where.workDate.gte.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(where.workDate.lt.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('surfaces absentDays from the parallel AbsenceRecord count query', async () => {
    prisma.attendanceRecord.findMany.mockResolvedValue([] as never);
    prisma.absenceRecord.count.mockResolvedValue(4 as never);

    const s = await service.getMyMonthlySummary(user, { year: 2026, month: 8 });
    expect(s.absentDays).toBe(4);
  });
});

describe('AttendanceService.getCompanyDashboard', () => {
  let prisma: PrismaMock;
  let service: AttendanceService;

  const hr: AuthenticatedUser = {
    id: 'hr-1',
    email: 'hr@a.test',
    companyId: 'company-1',
    departmentId: null,
    role: 'HR_MANAGER',
  };

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    mockReset(prisma);
    service = new AttendanceService(prisma, makeNotifications());
  });

  it('refuses non-HR / non-Super Admin actors', async () => {
    const supervisor = { ...hr, id: 'sup-1', role: 'SUPERVISOR' as const };
    await expect(service.getCompanyDashboard(supervisor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const employee = { ...hr, id: 'emp-1', role: 'EMPLOYEE' as const };
    await expect(service.getCompanyDashboard(employee)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns an empty snapshot when the company has no active users', async () => {
    prisma.user.findMany.mockResolvedValue([] as never);
    const result = await service.getCompanyDashboard(hr, { date: '2026-08-01' });
    expect(result.total).toBe(0);
    expect(result.departments).toEqual([]);
    expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled();
  });

  it('classifies clocked-in vs absent vs on-leave vs not-clocked-in', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', departmentId: 'd1', department: { name: 'Eng' } },
      { id: 'u2', departmentId: 'd1', department: { name: 'Eng' } },
      { id: 'u3', departmentId: 'd2', department: { name: 'HR' } },
      { id: 'u4', departmentId: 'd2', department: { name: 'HR' } },
    ] as never);
    prisma.attendanceRecord.findMany.mockResolvedValue([
      { userId: 'u1', status: 'ON_TIME', lateMinutes: 0, earlyLeaveMinutes: 0 },
    ] as never);
    prisma.absenceRecord.findMany.mockResolvedValue([{ userId: 'u2' }] as never);
    prisma.leaveRequest.findMany.mockResolvedValue([{ userId: 'u3' }] as never);

    const snap = await service.getCompanyDashboard(hr, { date: '2026-08-01' });
    expect(snap.total).toBe(4);
    expect(snap.clockedIn).toBe(1);
    expect(snap.absent).toBe(1);
    expect(snap.onLeave).toBe(1);
    expect(snap.notClockedIn).toBe(1);
    expect(snap.date).toBe('2026-08-01');
    expect(snap.departments).toHaveLength(2);
  });

  it('rejects malformed date query strings', async () => {
    await expect(service.getCompanyDashboard(hr, { date: 'not-a-date' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

// ---------------------------------------------------------------------------
// markAbsent + deleteAbsence — manual HR override
// ---------------------------------------------------------------------------

describe('AttendanceService.markAbsent', () => {
  let prisma: PrismaMock;
  let notifications: NotificationsMock;
  let service: AttendanceService;

  const hr: AuthenticatedUser = {
    id: 'hr-1',
    email: 'hr@a.test',
    companyId: 'company-1',
    departmentId: null,
    role: 'HR_MANAGER',
  };

  const targetUser = {
    id: 'emp-1',
    email: 'emp@a.test',
    fullName: 'Employee One',
    supervisorId: 'sup-1',
    supervisor: { id: 'sup-1', email: 'sup@a.test' },
    hiredAt: new Date('2024-01-01'),
  };

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    mockReset(prisma);
    notifications = makeNotifications();
    service = new AttendanceService(prisma, notifications);

    prisma.user.findFirst.mockResolvedValue(targetUser as never);
    prisma.company.findFirst.mockResolvedValue({ payrollLockedUntil: null } as never);
    prisma.attendanceRecord.findFirst.mockResolvedValue(null);
    prisma.absenceRecord.findFirst.mockResolvedValue(null);
    prisma.absenceRecord.create.mockResolvedValue({
      id: 'abs-1',
      companyId: hr.companyId,
      userId: targetUser.id,
      workDate: new Date('2026-07-30T00:00:00Z'),
      source: 'MANUAL_HR',
      reason: 'forgot to file',
      markedById: hr.id,
      createdAt: new Date('2026-08-01T00:00:00Z'),
    } as never);
    prisma.auditLog.create.mockResolvedValue({} as never);
  });

  it('refuses non-HR / non-Super Admin actors', async () => {
    const emp: AuthenticatedUser = { ...hr, id: 'e', role: 'EMPLOYEE' };
    await expect(
      service.markAbsent(emp, { userId: targetUser.id, workDate: '2026-07-30' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const sup: AuthenticatedUser = { ...hr, id: 's', role: 'SUPERVISOR' };
    await expect(
      service.markAbsent(sup, { userId: targetUser.id, workDate: '2026-07-30' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects invalid or future dates', async () => {
    await expect(
      service.markAbsent(hr, { userId: targetUser.id, workDate: 'not-a-date' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 5);
    const iso = future.toISOString().slice(0, 10);
    await expect(
      service.markAbsent(hr, { userId: targetUser.id, workDate: iso }),
    ).rejects.toMatchObject({ message: 'DATE_IN_FUTURE' });
  });

  it('rejects unknown / cross-tenant target user', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      service.markAbsent(hr, { userId: 'foreign', workDate: '2026-07-30' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects dates before the target was hired', async () => {
    prisma.user.findFirst.mockResolvedValue({
      ...targetUser,
      hiredAt: new Date('2026-01-01'),
    } as never);
    await expect(
      service.markAbsent(hr, { userId: targetUser.id, workDate: '2025-12-15' }),
    ).rejects.toMatchObject({ message: 'NOT_HIRED_YET' });
  });

  it('refuses when the user has an attendance record for that day', async () => {
    prisma.attendanceRecord.findFirst.mockResolvedValue({ id: 'a-1' } as never);
    await expect(
      service.markAbsent(hr, { userId: targetUser.id, workDate: '2026-07-30' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses when an AbsenceRecord already exists for the day', async () => {
    prisma.absenceRecord.findFirst.mockResolvedValue({
      id: 'abs-old',
      source: 'AUTO_SCHEDULER',
    } as never);
    await expect(
      service.markAbsent(hr, { userId: targetUser.id, workDate: '2026-07-30' }),
    ).rejects.toMatchObject({ message: 'ALREADY_MARKED' });
  });

  it('creates the record with source=MANUAL_HR and notifies employee + supervisor', async () => {
    const result = await service.markAbsent(hr, {
      userId: targetUser.id,
      workDate: '2026-07-30',
      reason: 'forgot to file',
    });

    expect(prisma.absenceRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: targetUser.id,
          source: 'MANUAL_HR',
          markedById: hr.id,
          reason: 'forgot to file',
        }),
      }),
    );

    expect(notifications.createOne).toHaveBeenCalledTimes(2);
    const calls = notifications.createOne.mock.calls;
    const employeeCall = calls.find(
      (c) => (c[0] as { recipientId: string }).recipientId === targetUser.id,
    );
    const supervisorCall = calls.find(
      (c) => (c[0] as { recipientId: string }).recipientId === targetUser.supervisor.id,
    );
    expect(employeeCall).toBeDefined();
    expect(supervisorCall).toBeDefined();

    expect(result).toMatchObject({
      id: 'abs-1',
      userId: targetUser.id,
      workDate: '2026-07-30',
      source: 'MANUAL_HR',
    });
  });

  it('skips supervisor notification when the target has none', async () => {
    prisma.user.findFirst.mockResolvedValue({
      ...targetUser,
      supervisorId: null,
      supervisor: null,
    } as never);
    await service.markAbsent(hr, { userId: targetUser.id, workDate: '2026-07-30' });
    expect(notifications.createOne).toHaveBeenCalledTimes(1);
  });

  it('trims and caps reason at 500 chars, storing null on empty', async () => {
    prisma.absenceRecord.create.mockResolvedValue({
      id: 'abs-2',
      companyId: hr.companyId,
      userId: targetUser.id,
      workDate: new Date('2026-07-30T00:00:00Z'),
      source: 'MANUAL_HR',
      reason: null,
      markedById: hr.id,
      createdAt: new Date('2026-08-01T00:00:00Z'),
    } as never);
    await service.markAbsent(hr, {
      userId: targetUser.id,
      workDate: '2026-07-30',
      reason: '   ',
    });
    const call = prisma.absenceRecord.create.mock.calls[0]?.[0] as
      { data: { reason: string | null } } | undefined;
    expect(call?.data.reason).toBeNull();

    const long = 'x'.repeat(600);
    await service.markAbsent(hr, {
      userId: targetUser.id,
      workDate: '2026-07-30',
      reason: long,
    });
    const secondCall = prisma.absenceRecord.create.mock.calls[1]?.[0] as
      { data: { reason: string | null } } | undefined;
    expect(secondCall?.data.reason?.length).toBe(500);
  });

  it('refuses HR marks inside a frozen payroll period with PAYROLL_LOCKED', async () => {
    prisma.company.findFirst.mockResolvedValue({
      payrollLockedUntil: new Date('2026-07-31T00:00:00Z'),
    } as never);
    await expect(
      service.markAbsent(hr, { userId: targetUser.id, workDate: '2026-07-30' }),
    ).rejects.toMatchObject({
      response: { code: 'PAYROLL_LOCKED', cutoffDate: '2026-07-31' },
    });
    // Sanity: no side effects when refused.
    expect(prisma.absenceRecord.create).not.toHaveBeenCalled();
  });

  it('allows SUPER_ADMIN to mark inside a frozen payroll period (emergency override)', async () => {
    prisma.company.findFirst.mockResolvedValue({
      payrollLockedUntil: new Date('2026-07-31T00:00:00Z'),
    } as never);
    const superAdmin: AuthenticatedUser = { ...hr, role: 'SUPER_ADMIN' };
    await expect(
      service.markAbsent(superAdmin, {
        userId: targetUser.id,
        workDate: '2026-07-30',
      }),
    ).resolves.toBeDefined();
    expect(prisma.absenceRecord.create).toHaveBeenCalled();
  });

  it('still allows HR marks strictly AFTER the cutoff', async () => {
    prisma.company.findFirst.mockResolvedValue({
      payrollLockedUntil: new Date('2026-07-31T00:00:00Z'),
    } as never);
    await expect(
      service.markAbsent(hr, { userId: targetUser.id, workDate: '2026-08-01' }),
    ).resolves.toBeDefined();
  });
});

describe('AttendanceService.deleteAbsence', () => {
  let prisma: PrismaMock;
  let service: AttendanceService;

  const hr: AuthenticatedUser = {
    id: 'hr-1',
    email: 'hr@a.test',
    companyId: 'company-1',
    departmentId: null,
    role: 'HR_MANAGER',
  };

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    mockReset(prisma);
    service = new AttendanceService(prisma, makeNotifications());
    prisma.absenceRecord.findFirst.mockResolvedValue({
      id: 'abs-1',
      userId: 'emp-1',
      workDate: new Date('2026-07-30T00:00:00Z'),
      source: 'AUTO_SCHEDULER',
      user: { id: 'emp-1', email: 'emp@a.test', companyId: hr.companyId },
    } as never);
    prisma.company.findFirst.mockResolvedValue({ payrollLockedUntil: null } as never);
    prisma.absenceRecord.delete.mockResolvedValue({} as never);
    prisma.auditLog.create.mockResolvedValue({} as never);
  });

  it('refuses non-HR / non-Super Admin actors', async () => {
    const emp: AuthenticatedUser = { ...hr, id: 'e', role: 'EMPLOYEE' };
    await expect(service.deleteAbsence(emp, 'abs-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns 404 when the record is missing or cross-tenant', async () => {
    prisma.absenceRecord.findFirst.mockResolvedValue(null);
    await expect(service.deleteAbsence(hr, 'abs-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes the record + writes an audit log', async () => {
    await service.deleteAbsence(hr, 'abs-1');
    expect(prisma.absenceRecord.delete).toHaveBeenCalledWith({ where: { id: 'abs-1' } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'ATTENDANCE_UNMARK_ABSENT',
          entityType: 'AbsenceRecord',
          entityId: 'abs-1',
        }),
      }),
    );
  });

  it('refuses HR deletes inside a frozen payroll period with PAYROLL_LOCKED', async () => {
    prisma.company.findFirst.mockResolvedValue({
      payrollLockedUntil: new Date('2026-07-31T00:00:00Z'),
    } as never);
    // The mocked absence row is at 2026-07-30 — inside the frozen period.
    await expect(service.deleteAbsence(hr, 'abs-1')).rejects.toMatchObject({
      response: { code: 'PAYROLL_LOCKED', cutoffDate: '2026-07-31' },
    });
    expect(prisma.absenceRecord.delete).not.toHaveBeenCalled();
  });

  it('allows SUPER_ADMIN to delete inside a frozen payroll period', async () => {
    prisma.company.findFirst.mockResolvedValue({
      payrollLockedUntil: new Date('2026-07-31T00:00:00Z'),
    } as never);
    const superAdmin: AuthenticatedUser = { ...hr, role: 'SUPER_ADMIN' };
    await expect(service.deleteAbsence(superAdmin, 'abs-1')).resolves.toBeUndefined();
    expect(prisma.absenceRecord.delete).toHaveBeenCalled();
  });
});
