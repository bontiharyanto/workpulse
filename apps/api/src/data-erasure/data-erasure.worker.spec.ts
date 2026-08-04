import type { ConfigService } from '@nestjs/config';
import type { DataErasureRequest } from '@prisma/client';
import { DataErasureStatus } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import type { DataErasureService } from './data-erasure.service';
import { DataErasureWorker } from './data-erasure.worker';
import type { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';

// The worker delegates the destructive DB work to `anonymizeUser`. We
// mock that entire module so the worker test focuses on the tick
// state-machine, not the anonymisation semantics (which are covered by
// `anonymize-user.spec.ts`).
jest.mock('./domain/anonymize-user', () => ({
  anonymizeUser: jest.fn(async () => ({
    erasedEmail: 'erased-user-1@workpulse.deleted',
    refreshTokensRevoked: 2,
    backupCodesDeleted: 1,
    notificationsDeleted: 3,
    passwordResetsDeleted: 0,
    notificationPrefsDeleted: 4,
    dataExportFileKeys: ['data-exports/x.zip'],
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { anonymizeUser } = require('./domain/anonymize-user') as {
  anonymizeUser: jest.Mock;
};

interface Kit {
  worker: DataErasureWorker;
  prisma: DeepMockProxy<PrismaService>;
  service: DeepMockProxy<DataErasureService>;
  notifications: DeepMockProxy<NotificationService>;
}

function buildKit(): Kit {
  const prisma = mockDeep<PrismaService>();
  const service = mockDeep<DataErasureService>();
  const notifications = mockDeep<NotificationService>();
  mockReset(prisma);
  mockReset(service);
  mockReset(notifications);
  anonymizeUser.mockClear();

  const config = {
    get: jest.fn((_key: string, def?: string): string | undefined => def),
  } as unknown as ConfigService;

  const worker = new DataErasureWorker(prisma, service, notifications, config);
  return { worker, prisma, service, notifications };
}

function makeRow(overrides: Partial<DataErasureRequest> = {}): DataErasureRequest {
  return {
    id: 'era-1',
    userId: 'user-1',
    companyId: 'company-1',
    status: DataErasureStatus.APPROVED_SCHEDULED,
    reason: null,
    requestedAt: new Date('2026-08-01T00:00:00Z'),
    decidedById: 'hr-1',
    decidedAt: new Date('2026-08-01T00:05:00Z'),
    decisionNote: null,
    scheduledFor: new Date('2026-08-02T00:05:00Z'),
    executedAt: null,
    cancelledAt: null,
    failedAt: null,
    failureReason: null,
    ...overrides,
  };
}

describe('DataErasureWorker', () => {
  it('executes anonymisation, flips to EXECUTED, writes audit', async () => {
    const { worker, prisma, service, notifications } = buildKit();

    // First $transaction: claim query returns 1 row id.
    // Second $transaction: anonymise + status flip.
    // Third: notifyPostExecution reads approvers — findMany direct.
    prisma.$transaction
      .mockImplementationOnce(async (cb: unknown) => {
        if (typeof cb === 'function') {
          const tx = prisma as unknown as { $queryRawUnsafe: jest.Mock };
          tx.$queryRawUnsafe = jest.fn(async () => [{ id: 'era-1' }]);
          const inner = prisma as unknown as {
            dataErasureRequest: { findUnique: jest.Mock };
          };
          inner.dataErasureRequest.findUnique = jest.fn(async () => makeRow());
          return (cb as (tx: unknown) => unknown)(prisma);
        }
        throw new Error('bad tx shape');
      })
      .mockImplementationOnce(async (cb: unknown) => {
        if (typeof cb === 'function') {
          return (cb as (tx: unknown) => unknown)(prisma);
        }
        throw new Error('bad tx shape');
      });

    prisma.user.findUnique.mockResolvedValueOnce({
      email: 'andi@example.com',
      fullName: 'Andi',
    } as never);
    prisma.dataErasureRequest.update.mockResolvedValue(
      makeRow({ status: DataErasureStatus.EXECUTED }),
    );
    prisma.user.findMany.mockResolvedValue([{ id: 'hr-1', email: 'hr@example.com' }] as never);
    service.deleteExportedArchives.mockResolvedValue();
    notifications.createOne.mockResolvedValue();

    await worker.tick();

    expect(anonymizeUser).toHaveBeenCalledTimes(1);
    expect(service.deleteExportedArchives).toHaveBeenCalledWith(['data-exports/x.zip']);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'DATA_ERASURE_EXECUTED',
          actorId: 'hr-1',
        }),
      }),
    );
  });

  it('flips to FAILED when the anonymiser throws', async () => {
    const { worker, prisma } = buildKit();
    anonymizeUser.mockImplementationOnce(async () => {
      throw new Error('boom');
    });

    prisma.$transaction
      .mockImplementationOnce(async (cb: unknown) => {
        if (typeof cb === 'function') {
          (prisma as unknown as { $queryRawUnsafe: jest.Mock }).$queryRawUnsafe = jest.fn(
            async () => [{ id: 'era-1' }],
          );
          (
            prisma as unknown as {
              dataErasureRequest: { findUnique: jest.Mock };
            }
          ).dataErasureRequest.findUnique = jest.fn(async () => makeRow());
          return (cb as (tx: unknown) => unknown)(prisma);
        }
        throw new Error('bad tx shape');
      })
      .mockImplementationOnce(async (cb: unknown) => {
        if (typeof cb === 'function') {
          return (cb as (tx: unknown) => unknown)(prisma);
        }
        throw new Error('bad tx shape');
      })
      .mockImplementationOnce(async (cb: unknown) => {
        if (typeof cb === 'function') {
          return (cb as (tx: unknown) => unknown)(prisma);
        }
        throw new Error('bad tx shape');
      });

    prisma.user.findUnique.mockResolvedValue({
      email: 'x@x.io',
      fullName: 'X',
    } as never);
    prisma.dataErasureRequest.update.mockResolvedValue(
      makeRow({ status: DataErasureStatus.FAILED }),
    );

    await worker.tick();

    expect(prisma.dataErasureRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: DataErasureStatus.FAILED }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'DATA_ERASURE_FAILED' }),
      }),
    );
  });

  it('is idle when no rows are claimable', async () => {
    const { worker, prisma } = buildKit();
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === 'function') {
        (prisma as unknown as { $queryRawUnsafe: jest.Mock }).$queryRawUnsafe = jest.fn(
          async () => [],
        );
        return (cb as (tx: unknown) => unknown)(prisma);
      }
      throw new Error('bad tx shape');
    });

    await worker.tick();
    expect(anonymizeUser).not.toHaveBeenCalled();
  });
});
