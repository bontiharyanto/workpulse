import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { VendorProcessor } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import { VendorProcessorService } from './vendor-processor.service';

/**
 * Fase 31f — service-level tests. Focus on the state-machine
 * invariants and the DPA precondition; the cadence math itself is
 * covered exhaustively by `vendor-review-cadence.spec.ts`.
 */

const COMPANY = 'company-1';

const actor: AuthenticatedUser = {
  id: 'user-1',
  companyId: COMPANY,
  role: 'HR_MANAGER',
  email: 'hr@example.com',
} as unknown as AuthenticatedUser;

function baseVendor(overrides: Partial<VendorProcessor> = {}): VendorProcessor {
  return {
    id: 'v-1',
    companyId: COMPANY,
    slug: 'payroll-nusantara',
    name: 'PT Payroll Nusantara',
    category: 'PAYROLL',
    status: 'UNDER_REVIEW',
    description: 'Payroll processor for the tenant.',
    dataCategories: ['BASIC_IDENTITY', 'EMPLOYMENT'],
    personalDataVolume: 'MEDIUM',
    dataResidency: 'Indonesia',
    contactName: 'Andi',
    contactEmail: 'dpo@vendor.co.id',
    contactPhone: null,
    contractDocumentUrl: null,
    contractStartAt: null,
    contractEndAt: null,
    dpaSignedAt: null,
    subprocessorsAllowed: false,
    securityCertifications: ['ISO27001'],
    nextReviewAt: new Date('2027-08-01T00:00:00Z'),
    lastReviewedAt: null,
    lastReviewNote: null,
    terminatedAt: null,
    terminatedReason: null,
    terminatedById: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdById: 'user-1',
    updatedById: 'user-1',
    deletedAt: null,
    ...overrides,
  } as VendorProcessor;
}

interface Kit {
  service: VendorProcessorService;
  prisma: DeepMockProxy<PrismaService>;
}

function buildKit(): Kit {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb !== 'function') throw new Error('unsupported tx call in mock');
    return (cb as (tx: unknown) => Promise<unknown>)(prisma);
  });
  const service = new VendorProcessorService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('VendorProcessorService', () => {
  describe('update — state machine', () => {
    it('refuses to flip UNDER_REVIEW → ACTIVE when DPA is unsigned', async () => {
      const { service, prisma } = buildKit();
      prisma.vendorProcessor.findFirst.mockResolvedValue(
        baseVendor({ status: 'UNDER_REVIEW', dpaSignedAt: null }),
      );

      await expect(service.update(actor, 'v-1', { status: 'ACTIVE' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('allows UNDER_REVIEW → ACTIVE once a DPA date is on the wire', async () => {
      const { service, prisma } = buildKit();
      const before = baseVendor({ status: 'UNDER_REVIEW', dpaSignedAt: null });
      prisma.vendorProcessor.findFirst.mockResolvedValue(before);
      prisma.vendorProcessor.update.mockResolvedValue({
        ...before,
        status: 'ACTIVE',
        dpaSignedAt: new Date('2026-02-01T00:00:00Z'),
      } as never);

      await service.update(actor, 'v-1', {
        status: 'ACTIVE',
        dpaSignedAt: new Date('2026-02-01T00:00:00Z'),
      });

      expect(prisma.vendorProcessor.update).toHaveBeenCalledTimes(1);
    });

    it('rejects any mutation on a TERMINATED vendor', async () => {
      const { service, prisma } = buildKit();
      prisma.vendorProcessor.findFirst.mockResolvedValue(
        baseVendor({ status: 'TERMINATED', terminatedAt: new Date() }),
      );

      await expect(service.update(actor, 'v-1', { name: 'New Name' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects illegal transitions (ACTIVE → UNDER_REVIEW)', async () => {
      const { service, prisma } = buildKit();
      prisma.vendorProcessor.findFirst.mockResolvedValue(
        baseVendor({ status: 'ACTIVE', dpaSignedAt: new Date() }),
      );

      await expect(service.update(actor, 'v-1', { status: 'UNDER_REVIEW' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects an inverted contract window at update time', async () => {
      const { service, prisma } = buildKit();
      prisma.vendorProcessor.findFirst.mockResolvedValue(
        baseVendor({ contractStartAt: new Date('2026-03-01T00:00:00Z') }),
      );

      await expect(
        service.update(actor, 'v-1', {
          contractEndAt: new Date('2026-02-01T00:00:00Z'),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFound for cross-tenant peeking', async () => {
      const { service, prisma } = buildKit();
      prisma.vendorProcessor.findFirst.mockResolvedValue(null);

      await expect(
        service.update(actor, 'other-tenant-vendor', { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('terminate', () => {
    it('stamps terminatedAt, reason, and actor id in one transaction', async () => {
      const { service, prisma } = buildKit();
      const before = baseVendor({ status: 'ACTIVE', dpaSignedAt: new Date() });
      prisma.vendorProcessor.findFirst.mockResolvedValue(before);
      prisma.vendorProcessor.update.mockResolvedValue({
        ...before,
        status: 'TERMINATED',
        terminatedAt: new Date(),
        terminatedReason: 'Contract lapsed cleanly.',
        terminatedById: actor.id,
      } as never);

      await service.terminate(actor, 'v-1', 'Contract lapsed cleanly.');

      expect(prisma.vendorProcessor.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'v-1' },
          data: expect.objectContaining({
            status: 'TERMINATED',
            terminatedReason: 'Contract lapsed cleanly.',
            terminatedById: actor.id,
          }),
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'VENDOR_PROCESSOR_TERMINATED',
            entityType: 'VendorProcessor',
          }),
        }),
      );
    });

    it('rejects a second terminate attempt', async () => {
      const { service, prisma } = buildKit();
      prisma.vendorProcessor.findFirst.mockResolvedValue(
        baseVendor({ status: 'TERMINATED', terminatedAt: new Date() }),
      );

      await expect(service.terminate(actor, 'v-1', 'again')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('markReviewed', () => {
    it('bumps nextReviewAt by the default cadence when caller omits it', async () => {
      const { service, prisma } = buildKit();
      const before = baseVendor({ status: 'ACTIVE', dpaSignedAt: new Date() });
      prisma.vendorProcessor.findFirst.mockResolvedValue(before);
      prisma.vendorProcessor.update.mockResolvedValue({
        ...before,
        lastReviewedAt: new Date(),
        nextReviewAt: new Date(),
      } as never);

      await service.markReviewed(actor, 'v-1', 'SOC2 renewed', undefined);

      const updateArgs = prisma.vendorProcessor.update.mock.calls[0]![0];
      const data = updateArgs.data as {
        lastReviewedAt: Date;
        nextReviewAt: Date;
        lastReviewNote: string | null;
      };
      const cadenceDays = Math.round(
        (data.nextReviewAt.getTime() - data.lastReviewedAt.getTime()) / 86_400_000,
      );
      expect(cadenceDays).toBe(365);
      expect(data.lastReviewNote).toBe('SOC2 renewed');
    });

    it('uses the caller-supplied nextReviewAt when provided', async () => {
      const { service, prisma } = buildKit();
      const before = baseVendor({ status: 'ACTIVE', dpaSignedAt: new Date() });
      prisma.vendorProcessor.findFirst.mockResolvedValue(before);
      prisma.vendorProcessor.update.mockResolvedValue(before as never);

      const custom = new Date('2027-06-01T00:00:00Z');
      await service.markReviewed(actor, 'v-1', null, custom);

      const data = prisma.vendorProcessor.update.mock.calls[0]![0].data as {
        nextReviewAt: Date;
      };
      expect(data.nextReviewAt.toISOString()).toBe(custom.toISOString());
    });

    it('refuses to review a TERMINATED vendor', async () => {
      const { service, prisma } = buildKit();
      prisma.vendorProcessor.findFirst.mockResolvedValue(
        baseVendor({ status: 'TERMINATED', terminatedAt: new Date() }),
      );

      await expect(service.markReviewed(actor, 'v-1', null)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('create', () => {
    it('rejects a duplicate slug (P2002) with ConflictException', async () => {
      const { service, prisma } = buildKit();
      const err = Object.assign(new Error('unique constraint failed'), { code: 'P2002' });
      prisma.vendorProcessor.create.mockRejectedValue(err);

      await expect(
        service.create(actor, {
          slug: 'payroll-nusantara',
          name: 'Vendor',
          category: 'PAYROLL',
          description: 'Duplicate slug retry.',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('linkRopa', () => {
    it('rejects a duplicate link (P2002) with ConflictException', async () => {
      const { service, prisma } = buildKit();
      prisma.vendorProcessor.findFirst.mockResolvedValue(baseVendor());
      prisma.ropaActivity.findFirst.mockResolvedValue({
        id: 'r-1',
        companyId: COMPANY,
      } as never);
      const err = Object.assign(new Error('unique constraint failed'), { code: 'P2002' });
      prisma.ropaActivityVendor.create.mockRejectedValue(err);

      await expect(
        service.linkRopa(actor, 'v-1', 'r-1', 'Same link twice.'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
