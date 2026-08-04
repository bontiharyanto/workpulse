import { BadRequestException } from '@nestjs/common';
import type { RetentionPolicy } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { RetentionService } from './retention.service';
import { PrismaService } from '../prisma/prisma.service';


interface Kit {
  service: RetentionService;
  prisma: DeepMockProxy<PrismaService>;
}

function buildKit(): Kit {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  const service = new RetentionService(prisma);
  return { service, prisma };
}

function makePolicy(overrides: Partial<RetentionPolicy> = {}): RetentionPolicy {
  return {
    id: 'rp-1',
    companyId: 'c-1',
    notificationRetentionDays: 90,
    dataExportArchiveRetentionHours: 24,
    terminatedUserAnonymizeDays: 0,
    updatedAt: new Date('2026-08-02T00:00:00Z'),
    updatedById: null,
    ...overrides,
  };
}

describe('RetentionService.getForCompany', () => {
  it('returns existing row without upserting', async () => {
    const { service, prisma } = buildKit();
    const row = makePolicy();
    prisma.retentionPolicy.findUnique.mockResolvedValue(row);

    const result = await service.getForCompany('c-1');

    expect(result).toBe(row);
    expect(prisma.retentionPolicy.upsert).not.toHaveBeenCalled();
  });

  it('lazily creates a default row when none exists', async () => {
    const { service, prisma } = buildKit();
    prisma.retentionPolicy.findUnique.mockResolvedValue(null);
    prisma.retentionPolicy.upsert.mockResolvedValue(makePolicy());

    const result = await service.getForCompany('c-1');

    expect(result.notificationRetentionDays).toBe(90);
    expect(prisma.retentionPolicy.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'c-1' },
        create: expect.objectContaining({
          companyId: 'c-1',
          notificationRetentionDays: 90,
          dataExportArchiveRetentionHours: 24,
          terminatedUserAnonymizeDays: 0,
        }),
      }),
    );
  });
});

describe('RetentionService.validate', () => {
  it('rejects negative notification retention', () => {
    const { service } = buildKit();
    expect(() => service.validate({ notificationRetentionDays: -1 })).toThrow(BadRequestException);
  });

  it('rejects out-of-range data-export retention hours', () => {
    const { service } = buildKit();
    expect(() => service.validate({ dataExportArchiveRetentionHours: 1000 })).toThrow(
      BadRequestException,
    );
  });

  it('rejects non-integer terminatedUserAnonymizeDays', () => {
    const { service } = buildKit();
    expect(() => service.validate({ terminatedUserAnonymizeDays: 3.5 })).toThrow(
      BadRequestException,
    );
  });

  it('accepts values at the boundary', () => {
    const { service } = buildKit();
    expect(() =>
      service.validate({
        notificationRetentionDays: 0,
        dataExportArchiveRetentionHours: 168,
        terminatedUserAnonymizeDays: 3650,
      }),
    ).not.toThrow();
  });
});

describe('RetentionService.update', () => {
  it('writes an audit log entry inside the transaction', async () => {
    const { service, prisma } = buildKit();
    const updated = makePolicy({
      notificationRetentionDays: 30,
      updatedById: 'admin-1',
    });

    // Simulate the transaction plumbing.
    const tx = {
      retentionPolicy: {
        upsert: jest.fn().mockResolvedValue(makePolicy()),
        update: jest.fn().mockResolvedValue(updated),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };

    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === 'function') {
        return (cb as (t: unknown) => unknown)(tx);
      }
      return undefined;
    });

    const result = await service.update(
      { id: 'admin-1', companyId: 'c-1', role: 'HR_MANAGER' },
      { notificationRetentionDays: 30 },
    );

    expect(result).toBe(updated);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((tx.auditLog.create as any).mock.calls[0][0].data).toMatchObject({
      companyId: 'c-1',
      actorId: 'admin-1',
      action: 'RETENTION_POLICY_UPDATED',
      entityType: 'RetentionPolicy',
    });
  });
});
