import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DataErasureRequest } from '@prisma/client';
import { DataErasureStatus } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { DataErasureService } from './data-erasure.service';
import type { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import type { StorageProvider } from '../storage/storage.provider';


interface Kit {
  service: DataErasureService;
  prisma: DeepMockProxy<PrismaService>;
  notifications: DeepMockProxy<NotificationService>;
  storage: DeepMockProxy<StorageProvider>;
}

function buildKit(overrides: Record<string, string> = {}): Kit {
  const prisma = mockDeep<PrismaService>();
  const notifications = mockDeep<NotificationService>();
  const storage = mockDeep<StorageProvider>();
  mockReset(prisma);
  mockReset(notifications);
  mockReset(storage);
  // `mockDeep` returns `undefined` from unset methods; the service
  // chains `.catch()` on the createOne call, which explodes on
  // `undefined`. Default to a resolved promise for happy-path tests.
  notifications.createOne.mockResolvedValue(undefined as never);
  prisma.user.findMany.mockResolvedValue([] as never);

  const config = {
    get: jest.fn((key: string, def?: string): string | undefined => {
      const env: Record<string, string> = {
        DATA_ERASURE_GRACE_DAYS: '7',
        ...overrides,
      };
      return env[key] ?? def;
    }),
  } as unknown as ConfigService;

  const service = new DataErasureService(prisma, notifications, storage, config);
  return { service, prisma, notifications, storage };
}

function makeRow(overrides: Partial<DataErasureRequest> = {}): DataErasureRequest {
  return {
    id: 'era-1',
    userId: 'user-1',
    companyId: 'company-1',
    status: DataErasureStatus.PENDING_APPROVAL,
    reason: null,
    requestedAt: new Date('2026-08-01T00:00:00Z'),
    decidedById: null,
    decidedAt: null,
    decisionNote: null,
    scheduledFor: null,
    executedAt: null,
    cancelledAt: null,
    failedAt: null,
    failureReason: null,
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// create
// -----------------------------------------------------------------------------

describe('DataErasureService.create', () => {
  it('creates a PENDING row when no active request exists', async () => {
    const { service, prisma } = buildKit();
    prisma.dataErasureRequest.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      fullName: 'Andi',
      deletedAt: null,
    } as never);
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === 'function') {
        return (cb as (tx: unknown) => unknown)(prisma);
      }
      throw new Error('unexpected tx shape');
    });
    const created = makeRow();
    prisma.dataErasureRequest.create.mockResolvedValue(created);

    const out = await service.create('user-1', 'company-1', 'karena tidak lagi bekerja');

    expect(out).toBe(created);
    expect(prisma.dataErasureRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        companyId: 'company-1',
        reason: 'karena tidak lagi bekerja',
        status: DataErasureStatus.PENDING_APPROVAL,
      }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'DATA_ERASURE_REQUESTED',
          entityId: created.id,
        }),
      }),
    );
  });

  it('rejects with 409 when an in-flight request already exists', async () => {
    const { service, prisma } = buildKit();
    prisma.dataErasureRequest.findFirst.mockResolvedValue(
      makeRow({ status: DataErasureStatus.APPROVED_SCHEDULED }),
    );
    await expect(service.create('user-1', 'company-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects when user is soft-deleted', async () => {
    const { service, prisma } = buildKit();
    prisma.dataErasureRequest.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      fullName: 'Andi',
      deletedAt: new Date(),
    } as never);
    await expect(service.create('user-1', 'company-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

// -----------------------------------------------------------------------------
// cancel
// -----------------------------------------------------------------------------

describe('DataErasureService.cancel', () => {
  it('flips PENDING_APPROVAL → CANCELLED with audit', async () => {
    const { service, prisma } = buildKit();
    const row = makeRow();
    prisma.dataErasureRequest.findUnique.mockResolvedValue(row);
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === 'function') {
        return (cb as (tx: unknown) => unknown)(prisma);
      }
      throw new Error('unexpected tx shape');
    });
    const updated = makeRow({
      status: DataErasureStatus.CANCELLED,
      cancelledAt: new Date(),
    });
    prisma.dataErasureRequest.update.mockResolvedValue(updated);

    const out = await service.cancel('user-1', row.id);
    expect(out).toBe(updated);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'DATA_ERASURE_CANCELLED' }),
      }),
    );
  });

  it('404s when a different user tries to cancel the row', async () => {
    const { service, prisma } = buildKit();
    prisma.dataErasureRequest.findUnique.mockResolvedValue(makeRow());
    await expect(service.cancel('other-user', 'era-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409s once the request has been EXECUTED', async () => {
    const { service, prisma } = buildKit();
    prisma.dataErasureRequest.findUnique.mockResolvedValue(
      makeRow({ status: DataErasureStatus.EXECUTED }),
    );
    await expect(service.cancel('user-1', 'era-1')).rejects.toBeInstanceOf(ConflictException);
  });
});

// -----------------------------------------------------------------------------
// approve / reject
// -----------------------------------------------------------------------------

describe('DataErasureService.approve', () => {
  it('sets APPROVED_SCHEDULED with scheduledFor = now + graceDays', async () => {
    const { service, prisma } = buildKit();
    const row = makeRow();
    prisma.dataErasureRequest.findUnique.mockResolvedValue(row);
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === 'function') {
        return (cb as (tx: unknown) => unknown)(prisma);
      }
      throw new Error('unexpected tx shape');
    });
    let capturedScheduledFor: Date | undefined;
    prisma.dataErasureRequest.update.mockImplementation((args: unknown) => {
      const a = args as { data: { scheduledFor?: Date } };
      capturedScheduledFor = a.data.scheduledFor;
      return Promise.resolve(
        makeRow({
          status: DataErasureStatus.APPROVED_SCHEDULED,
          decidedById: 'hr-1',
          decidedAt: new Date(),
          scheduledFor: capturedScheduledFor ?? null,
        }),
      ) as never;
    });
    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Andi',
      email: 'andi@example.com',
    } as never);

    const out = await service.approve(
      { id: 'hr-1', role: 'HR_MANAGER', companyId: 'company-1' },
      row.id,
    );

    expect(out.status).toBe(DataErasureStatus.APPROVED_SCHEDULED);
    expect(capturedScheduledFor).toBeInstanceOf(Date);
    const nowMs = Date.now();
    const sfMs = capturedScheduledFor!.getTime();
    expect(sfMs - nowMs).toBeGreaterThan(604_800_000 - 1_000);
    expect(sfMs - nowMs).toBeLessThan(604_800_000 + 1_000);
  });

  it('rejects when actor is not HR_MANAGER or SUPER_ADMIN', async () => {
    const { service } = buildKit();
    await expect(
      service.approve({ id: 'sup-1', role: 'SUPERVISOR', companyId: 'company-1' }, 'era-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403s when HR tries to approve their own request', async () => {
    const { service, prisma } = buildKit();
    prisma.dataErasureRequest.findUnique.mockResolvedValue(makeRow({ userId: 'hr-1' }));
    await expect(
      service.approve({ id: 'hr-1', role: 'HR_MANAGER', companyId: 'company-1' }, 'era-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('SUPER_ADMIN can also approve', async () => {
    const { service, prisma } = buildKit();
    prisma.dataErasureRequest.findUnique.mockResolvedValue(makeRow());
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === 'function') {
        return (cb as (tx: unknown) => unknown)(prisma);
      }
      throw new Error('unexpected tx shape');
    });
    prisma.dataErasureRequest.update.mockResolvedValue(
      makeRow({ status: DataErasureStatus.APPROVED_SCHEDULED }),
    );
    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Andi',
      email: 'andi@example.com',
    } as never);

    const out = await service.approve(
      { id: 'sa-1', role: 'SUPER_ADMIN', companyId: 'company-1' },
      'era-1',
    );
    expect(out.status).toBe(DataErasureStatus.APPROVED_SCHEDULED);
  });

  it('409s if the request is not PENDING_APPROVAL', async () => {
    const { service, prisma } = buildKit();
    prisma.dataErasureRequest.findUnique.mockResolvedValue(
      makeRow({ status: DataErasureStatus.EXECUTED }),
    );
    await expect(
      service.approve({ id: 'hr-1', role: 'HR_MANAGER', companyId: 'company-1' }, 'era-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('404s across tenants', async () => {
    const { service, prisma } = buildKit();
    prisma.dataErasureRequest.findUnique.mockResolvedValue(makeRow({ companyId: 'other-tenant' }));
    await expect(
      service.approve({ id: 'hr-1', role: 'HR_MANAGER', companyId: 'company-1' }, 'era-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DataErasureService.reject', () => {
  it('requires a note', async () => {
    const { service } = buildKit();
    await expect(
      service.reject({ id: 'hr-1', role: 'HR_MANAGER', companyId: 'company-1' }, 'era-1', ''),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects PENDING_APPROVAL with the note stored', async () => {
    const { service, prisma } = buildKit();
    prisma.dataErasureRequest.findUnique.mockResolvedValue(makeRow());
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === 'function') {
        return (cb as (tx: unknown) => unknown)(prisma);
      }
      throw new Error('unexpected tx shape');
    });
    prisma.dataErasureRequest.update.mockResolvedValue(
      makeRow({
        status: DataErasureStatus.REJECTED,
        decisionNote: 'kontrak masih aktif',
      }),
    );
    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Andi',
      email: 'andi@example.com',
    } as never);

    const out = await service.reject(
      { id: 'hr-1', role: 'HR_MANAGER', companyId: 'company-1' },
      'era-1',
      'kontrak masih aktif',
    );
    expect(out.status).toBe(DataErasureStatus.REJECTED);
  });
});
