import { ConfigService } from '@nestjs/config';
import type { VendorProcessor } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';

import { VendorReviewReminderWorker } from './vendor-review-reminder.worker';

const COMPANY = 'company-1';

function vendor(overrides: Partial<VendorProcessor> = {}): VendorProcessor {
  return {
    id: 'v-1',
    companyId: COMPANY,
    slug: 'x',
    name: 'PT Vendor',
    category: 'PAYROLL',
    status: 'ACTIVE',
    description: 'x',
    dataCategories: [],
    personalDataVolume: 'LOW',
    dataResidency: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    contractDocumentUrl: null,
    contractStartAt: null,
    contractEndAt: null,
    dpaSignedAt: null,
    subprocessorsAllowed: false,
    securityCertifications: [],
    nextReviewAt: new Date('2027-01-01T00:00:00Z'),
    lastReviewedAt: null,
    lastReviewNote: null,
    terminatedAt: null,
    terminatedReason: null,
    terminatedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: null,
    updatedById: null,
    deletedAt: null,
    ...overrides,
  } as VendorProcessor;
}

interface Kit {
  worker: VendorReviewReminderWorker;
  prisma: DeepMockProxy<PrismaService>;
  notifications: jest.Mocked<Pick<NotificationService, 'createMany'>>;
}

function buildKit(enabled = 'true'): Kit {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  const notifications = {
    createMany: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Pick<NotificationService, 'createMany'>>;
  const config = {
    get: (_key: string, fallback?: unknown) => enabled ?? fallback,
  } as unknown as ConfigService;
  const worker = new VendorReviewReminderWorker(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationService,
    config,
  );
  return { worker, prisma, notifications };
}

describe('VendorReviewReminderWorker', () => {
  const now = new Date('2026-08-04T00:00:00Z');

  it('fires REVIEW_DUE + inserts dedup row when review is within 30d', async () => {
    const { worker, prisma, notifications } = buildKit();
    const target = vendor({
      nextReviewAt: new Date('2026-08-20T00:00:00Z'),
    });
    prisma.vendorProcessor.findMany.mockResolvedValue([target]);
    prisma.vendorReminderLog.create.mockResolvedValue({ id: 'l-1' } as never);
    prisma.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'hr@example.com' }] as never);

    const summary = await worker.runOnce(now);

    expect(summary.evaluated).toBe(1);
    expect(summary.fired).toBe(1);
    expect(prisma.vendorReminderLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'REVIEW_DUE' }),
      }),
    );
    expect(notifications.createMany).toHaveBeenCalled();
  });

  it('silently skips when the dedup log row already exists (P2002)', async () => {
    const { worker, prisma, notifications } = buildKit();
    prisma.vendorProcessor.findMany.mockResolvedValue([
      vendor({ nextReviewAt: new Date('2026-08-20T00:00:00Z') }),
    ]);
    const err = Object.assign(new Error('unique'), { code: 'P2002' });
    prisma.vendorReminderLog.create.mockRejectedValue(err);

    const summary = await worker.runOnce(now);
    expect(summary.fired).toBe(0);
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('does nothing for TERMINATED vendors even if cutoff is overdue', async () => {
    const { worker, prisma, notifications } = buildKit();
    prisma.vendorProcessor.findMany.mockResolvedValue([
      vendor({
        status: 'ACTIVE',
        nextReviewAt: new Date('2027-06-01T00:00:00Z'),
        contractEndAt: null,
      }),
    ]);

    const summary = await worker.runOnce(now);
    expect(summary.evaluated).toBe(1);
    expect(summary.fired).toBe(0);
    expect(prisma.vendorReminderLog.create).not.toHaveBeenCalled();
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('fires both REVIEW_DUE and CONTRACT_EXPIRING when both are near cutoff', async () => {
    const { worker, prisma, notifications } = buildKit();
    prisma.vendorProcessor.findMany.mockResolvedValue([
      vendor({
        nextReviewAt: new Date('2026-08-20T00:00:00Z'),
        contractEndAt: new Date('2026-09-15T00:00:00Z'),
      }),
    ]);
    prisma.vendorReminderLog.create.mockResolvedValue({ id: 'l-1' } as never);
    prisma.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'hr@example.com' }] as never);

    const summary = await worker.runOnce(now);
    expect(summary.fired).toBe(2);
    expect(notifications.createMany).toHaveBeenCalledTimes(2);
  });
});
