import { BadRequestException } from '@nestjs/common';
import { Prisma as PrismaNs } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { PrismaService } from '../prisma/prisma.service';

import { BacklogService } from './backlog.service';

const NOW = new Date('2026-08-02T12:00:00Z');

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

interface FakeLeave {
  id: string;
  userId: string;
  createdAt: Date;
  startDate: Date;
  endDate: Date;
  leaveType: { name: string };
  user: { fullName: string };
}
interface FakeOvertime {
  id: string;
  userId: string;
  createdAt: Date;
  workDate: Date;
  hours: PrismaNs.Decimal;
  user: { fullName: string };
}
interface FakeCorrection {
  id: string;
  userId: string;
  createdAt: Date;
  workDate: Date;
  requestedClockInAt: Date | null;
  requestedClockOutAt: Date | null;
  user: { fullName: string };
}

function setup(): {
  service: BacklogService;
  prisma: DeepMockProxy<PrismaService>;
} {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  const service = new BacklogService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('BacklogService.getBacklog', () => {
  it('aggregates PENDING rows across all three modules with correct age buckets', async () => {
    const { service, prisma } = setup();

    const leaveRows: FakeLeave[] = [
      {
        id: 'l1',
        userId: 'u1',
        createdAt: daysAgo(0),
        startDate: new Date('2026-08-10T00:00:00Z'),
        endDate: new Date('2026-08-11T00:00:00Z'),
        leaveType: { name: 'Annual' },
        user: { fullName: 'Alice' },
      },
      {
        id: 'l2',
        userId: 'u2',
        createdAt: daysAgo(5), // stale (5 >= 3)
        startDate: new Date('2026-08-15T00:00:00Z'),
        endDate: new Date('2026-08-15T00:00:00Z'),
        leaveType: { name: 'Sick' },
        user: { fullName: 'Bob' },
      },
    ];
    const overtimeRows: FakeOvertime[] = [
      {
        id: 'o1',
        userId: 'u1',
        createdAt: daysAgo(2),
        workDate: new Date('2026-08-01T00:00:00Z'),
        hours: new PrismaNs.Decimal('2.5'),
        user: { fullName: 'Alice' },
      },
    ];
    const correctionRows: FakeCorrection[] = [
      {
        id: 'c1',
        userId: 'u3',
        createdAt: daysAgo(9), // stale + d7_plus bucket
        workDate: new Date('2026-07-24T00:00:00Z'),
        requestedClockInAt: new Date('2026-07-24T09:00:00Z'),
        requestedClockOutAt: null,
        user: { fullName: 'Carol' },
      },
    ];

    prisma.leaveRequest.findMany.mockResolvedValue(leaveRows as never);
    prisma.overtimeRequest.findMany.mockResolvedValue(overtimeRows as never);
    prisma.attendanceCorrection.findMany.mockResolvedValue(correctionRows as never);

    const summary = await service.getBacklog({
      companyId: 'co-1',
      now: NOW,
    });

    expect(summary.staleAfterDays).toBe(3);
    expect(summary.generatedAt).toEqual(NOW);

    expect(summary.leave.total).toBe(2);
    expect(summary.leave.fresh).toBe(1);
    expect(summary.leave.stale).toBe(1);
    expect(summary.leave.buckets).toEqual({
      d0_1: 1,
      d1_3: 0,
      d3_7: 1,
      d7_plus: 0,
    });

    expect(summary.overtime.total).toBe(1);
    expect(summary.overtime.fresh).toBe(1);
    expect(summary.overtime.stale).toBe(0);

    expect(summary.correction.total).toBe(1);
    expect(summary.correction.fresh).toBe(0);
    expect(summary.correction.stale).toBe(1);
    expect(summary.correction.buckets.d7_plus).toBe(1);
    expect(summary.correction.oldest[0]?.summary).toContain('in 09:00');
  });

  it('scopes every query to the caller companyId (multi-tenant guard)', async () => {
    const { service, prisma } = setup();
    prisma.leaveRequest.findMany.mockResolvedValue([] as never);
    prisma.overtimeRequest.findMany.mockResolvedValue([] as never);
    prisma.attendanceCorrection.findMany.mockResolvedValue([] as never);

    await service.getBacklog({ companyId: 'tenant-X', now: NOW });

    for (const call of [
      prisma.leaveRequest.findMany.mock.calls[0]?.[0],
      prisma.overtimeRequest.findMany.mock.calls[0]?.[0],
      prisma.attendanceCorrection.findMany.mock.calls[0]?.[0],
    ]) {
      const where = call?.where as { companyId?: string } | undefined;
      expect(where?.companyId).toBe('tenant-X');
    }
  });

  it('honors a custom topN cap on oldest[]', async () => {
    const { service, prisma } = setup();
    const many: FakeLeave[] = Array.from({ length: 10 }, (_, i) => ({
      id: `l${i}`,
      userId: `u${i}`,
      createdAt: daysAgo(i),
      startDate: new Date('2026-08-01T00:00:00Z'),
      endDate: new Date('2026-08-01T00:00:00Z'),
      leaveType: { name: 'Annual' },
      user: { fullName: `User ${i}` },
    }));
    prisma.leaveRequest.findMany.mockResolvedValue(many as never);
    prisma.overtimeRequest.findMany.mockResolvedValue([] as never);
    prisma.attendanceCorrection.findMany.mockResolvedValue([] as never);

    const summary = await service.getBacklog({
      companyId: 'co-1',
      now: NOW,
      topN: 3,
    });
    expect(summary.leave.oldest).toHaveLength(3);
    // ascending-createdAt order means the oldest first — reflects the
    // service's `orderBy: { createdAt: 'asc' }` slice(0, N).
    expect(summary.leave.oldest[0]?.id).toBe('l0');
  });

  it('rejects an out-of-range thresholdDays with 400 INVALID_STALE_THRESHOLD', async () => {
    const { service } = setup();
    await expect(
      service.getBacklog({ companyId: 'co-1', now: NOW, staleAfterDays: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.getBacklog({ companyId: 'co-1', now: NOW, staleAfterDays: 61 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an out-of-range topN with 400 INVALID_TOP_N', async () => {
    const { service } = setup();
    await expect(
      service.getBacklog({ companyId: 'co-1', now: NOW, topN: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.getBacklog({ companyId: 'co-1', now: NOW, topN: 21 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
