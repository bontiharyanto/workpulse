import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import { ShiftService } from './shift.service';

const hr: AuthenticatedUser = {
  id: 'user-hr',
  email: 'hr@a.test',
  companyId: 'company-1',
  departmentId: null,
  role: 'HR_MANAGER',
};

function makeShift(
  overrides: Partial<{ id: string; activeAssignments: number; geofenceId: string | null }> = {},
) {
  return {
    id: overrides.id ?? 'shift-1',
    companyId: 'company-1',
    geofenceId: overrides.geofenceId ?? null,
    name: 'Morning',
    type: 'STATIC',
    startTime: '08:00',
    endTime: '17:00',
    graceMinutes: 10,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    geofence: null as null | { id: string; name: string },
    _count: { assignments: overrides.activeAssignments ?? 0 },
  };
}

function setup(): { service: ShiftService; prisma: DeepMockProxy<PrismaService> } {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  return { service: new ShiftService(prisma), prisma };
}

function stubTx(prisma: DeepMockProxy<PrismaService>): void {
  type Cb = (tx: PrismaService) => Promise<unknown>;
  prisma.$transaction.mockImplementation(((cb: Cb | unknown) => {
    if (typeof cb === 'function') return (cb as Cb)(prisma);
    return Promise.resolve(cb);
  }) as never);
}

// ==========================================================================
// create shift
// ==========================================================================
describe('ShiftService.create', () => {
  it('rejects zero-length shift times', async () => {
    const { service } = setup();
    await expect(
      service.create(hr, {
        name: 'Bad',
        type: 'STATIC',
        startTime: '09:00',
        endTime: '09:00',
        graceMinutes: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects geofenceId from another company', async () => {
    const { service, prisma } = setup();
    prisma.geofence.findFirst.mockResolvedValue(null as never);
    await expect(
      service.create(hr, {
        name: 'X',
        type: 'STATIC',
        startTime: '08:00',
        endTime: '17:00',
        graceMinutes: 0,
        geofenceId: 'other',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts cross-midnight shifts', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.shift.create.mockResolvedValue(makeShift({ id: 'sh-new' }) as never);
    prisma.shift.findFirst.mockResolvedValue(makeShift({ id: 'sh-new' }) as never);

    await expect(
      service.create(hr, {
        name: 'Night',
        type: 'STATIC',
        startTime: '22:00',
        endTime: '06:00',
        graceMinutes: 15,
      }),
    ).resolves.toBeDefined();
    expect(prisma.shift.create).toHaveBeenCalled();
  });

  it('maps unique-name conflict to SHIFT_NAME_TAKEN', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.shift.create.mockRejectedValue({ code: 'P2002' } as never);
    await expect(
      service.create(hr, {
        name: 'Dup',
        type: 'STATIC',
        startTime: '08:00',
        endTime: '17:00',
        graceMinutes: 0,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

// ==========================================================================
// delete shift
// ==========================================================================
describe('ShiftService.remove', () => {
  it('rejects while active assignments exist', async () => {
    const { service, prisma } = setup();
    prisma.shift.findFirst.mockResolvedValue(makeShift({ activeAssignments: 3 }) as never);
    await expect(service.remove(hr, 'shift-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('soft-deletes when no active assignments', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.shift.findFirst.mockResolvedValue(makeShift() as never);
    prisma.shift.update.mockResolvedValue({ ...makeShift(), deletedAt: new Date() } as never);

    await service.remove(hr, 'shift-1');
    expect(prisma.shift.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    );
  });
});

// ==========================================================================
// assignments
// ==========================================================================
describe('ShiftService.createAssignment', () => {
  it('rejects overlap with existing assignment for the same user', async () => {
    const { service, prisma } = setup();
    prisma.shift.findFirst.mockResolvedValue(makeShift() as never);
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' } as never);
    prisma.userShiftAssignment.findMany.mockResolvedValue([
      {
        id: 'a-existing',
        effectiveFrom: new Date('2026-03-01T00:00:00Z'),
        effectiveTo: null,
      },
    ] as never);

    await expect(
      service.createAssignment(hr, 'shift-1', {
        userId: 'u1',
        effectiveFrom: '2026-04-01',
        effectiveTo: '2026-05-01',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects effectiveTo before effectiveFrom', async () => {
    const { service, prisma } = setup();
    prisma.shift.findFirst.mockResolvedValue(makeShift() as never);
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' } as never);

    await expect(
      service.createAssignment(hr, 'shift-1', {
        userId: 'u1',
        effectiveFrom: '2026-05-01',
        effectiveTo: '2026-04-30',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects user from another company', async () => {
    const { service, prisma } = setup();
    prisma.shift.findFirst.mockResolvedValue(makeShift() as never);
    prisma.user.findFirst.mockResolvedValue(null as never);

    await expect(
      service.createAssignment(hr, 'shift-1', {
        userId: 'other-u',
        effectiveFrom: '2026-04-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('inserts assignment + audit log when non-overlapping', async () => {
    const { service, prisma } = setup();
    stubTx(prisma);
    prisma.shift.findFirst.mockResolvedValue(makeShift() as never);
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' } as never);
    prisma.userShiftAssignment.findMany.mockResolvedValue([] as never);
    prisma.userShiftAssignment.create.mockResolvedValue({ id: 'asg-new' } as never);
    prisma.userShiftAssignment.findUniqueOrThrow.mockResolvedValue({
      id: 'asg-new',
      userId: 'u1',
      shiftId: 'shift-1',
      effectiveFrom: new Date('2026-04-01T00:00:00Z'),
      effectiveTo: new Date('2026-05-01T00:00:00Z'),
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 'u1', fullName: 'Alice' },
      shift: { id: 'shift-1', name: 'Morning' },
    } as never);

    const dto = await service.createAssignment(hr, 'shift-1', {
      userId: 'u1',
      effectiveFrom: '2026-04-01',
      effectiveTo: '2026-05-01',
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'SHIFT_ASSIGNMENT_CREATED',
          entityId: 'asg-new',
        }),
      }),
    );
    expect(dto).toMatchObject({ userFullName: 'Alice', shiftName: 'Morning' });
  });
});

describe('ShiftService.endAssignment', () => {
  it('rejects effectiveTo before effectiveFrom', async () => {
    const { service, prisma } = setup();
    prisma.userShiftAssignment.findFirst.mockResolvedValue({
      id: 'a1',
      userId: 'u1',
      shiftId: 'shift-1',
      effectiveFrom: new Date('2026-04-01T00:00:00Z'),
      effectiveTo: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      shift: { companyId: 'company-1' },
    } as never);

    await expect(service.endAssignment(hr, 'a1', '2026-03-31')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws NotFound for cross-tenant lookup', async () => {
    const { service, prisma } = setup();
    prisma.userShiftAssignment.findFirst.mockResolvedValue(null as never);
    await expect(service.endAssignment(hr, 'a1', '2027-01-01')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
