import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { RopaActivity, RopaActivityVersion } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { ROPA_SEED_BLUEPRINTS } from './domain/seed-catalogue';
import { RopaRegistryService } from './ropa-registry.service';

interface Kit {
  service: RopaRegistryService;
  prisma: DeepMockProxy<PrismaService>;
}

function buildKit(): Kit {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);

  (prisma.$transaction as unknown as jest.Mock).mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: PrismaService) => unknown)(prisma);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });

  const service = new RopaRegistryService(prisma as unknown as PrismaService);
  return { service, prisma };
}

function makeActor(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'actor-1',
    companyId: 'c-1',
    departmentId: null,
    email: 'hr@example.com',
    role: 'HR_MANAGER',
    ...overrides,
  };
}

function makeActivity(overrides: Partial<RopaActivity> = {}): RopaActivity {
  return {
    id: 'a-1',
    companyId: 'c-1',
    slug: 'attendance-tracking',
    currentVersionId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeVersion(overrides: Partial<RopaActivityVersion> = {}): RopaActivityVersion {
  return {
    id: 'v-1',
    activityId: 'a-1',
    companyId: 'c-1',
    version: 1,
    status: 'DRAFT',
    name: 'Kehadiran Karyawan',
    purpose: 'Mencatat kehadiran karyawan.',
    legalBasis: 'CONTRACT',
    legalBasisDetail: null,
    dataCategories: ['BASIC_IDENTITY'],
    subjectCategories: ['EMPLOYEE'],
    recipients: ['Internal HR'],
    retentionPeriod: 'Masa kerja + 3 tahun.',
    crossBorderTransfer: false,
    crossBorderDetail: null,
    securityMeasures: 'RBAC + TLS + audit log.',
    notes: null,
    createdById: 'actor-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    reviewedById: null,
    reviewedAt: null,
    publishedById: null,
    publishedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

describe('RopaRegistryService', () => {
  // ---------------- createActivity ----------------
  describe('createActivity', () => {
    it('creates DRAFT v1 + audit row, returns version', async () => {
      const kit = buildKit();
      const actor = makeActor();
      const created = makeActivity();
      const version = makeVersion();

      kit.prisma.ropaActivity.create.mockResolvedValueOnce(created);
      kit.prisma.ropaActivityVersion.create.mockResolvedValueOnce(version);

      const result = await kit.service.createActivity(actor, {
        slug: 'attendance-tracking',
        name: 'Kehadiran Karyawan',
        purpose: 'Mencatat kehadiran.',
        legalBasis: 'CONTRACT',
        dataCategories: ['BASIC_IDENTITY'],
        subjectCategories: ['EMPLOYEE'],
        recipients: ['Internal HR'],
        retentionPeriod: 'Masa kerja + 3 tahun.',
        crossBorderTransfer: false,
        securityMeasures: 'RBAC + TLS.',
      });

      expect(result.id).toBe('v-1');
      expect(kit.prisma.ropaActivity.create).toHaveBeenCalledWith({
        data: { companyId: 'c-1', slug: 'attendance-tracking' },
      });
      expect(kit.prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'ROPA_VERSION_CREATED',
            entityType: 'RopaActivityVersion',
            actorId: 'actor-1',
          }),
        }),
      );
    });

    it('rejects invalid slug with 400', async () => {
      const kit = buildKit();
      await expect(
        kit.service.createActivity(makeActor(), {
          slug: 'X', // too short + uppercase
          name: 'ok',
          purpose: 'ok body',
          legalBasis: 'CONTRACT',
          dataCategories: [],
          subjectCategories: [],
          recipients: [],
          retentionPeriod: 'ok',
          crossBorderTransfer: false,
          securityMeasures: 'ok',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(kit.prisma.ropaActivity.create).not.toHaveBeenCalled();
    });

    it('maps P2002 duplicate slug to 409 ROPA_SLUG_TAKEN', async () => {
      const kit = buildKit();
      kit.prisma.ropaActivity.create.mockRejectedValueOnce({ code: 'P2002' });
      await expect(
        kit.service.createActivity(makeActor(), {
          slug: 'attendance-tracking',
          name: 'X',
          purpose: 'body',
          legalBasis: 'CONTRACT',
          dataCategories: [],
          subjectCategories: [],
          recipients: [],
          retentionPeriod: 'x',
          crossBorderTransfer: false,
          securityMeasures: 'x',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ---------------- seedDefaults ----------------
  describe('seedDefaults', () => {
    it('is idempotent — existing slugs are skipped, missing ones are created', async () => {
      const kit = buildKit();
      const actor = makeActor();
      const existingSlug = ROPA_SEED_BLUEPRINTS[0]!.slug;

      kit.prisma.ropaActivity.findUnique.mockImplementation((async (args: {
        where: { companyId_slug: { slug: string } };
      }) => {
        if (args.where.companyId_slug.slug === existingSlug) {
          return { id: 'existing' };
        }
        return null;
      }) as unknown as typeof kit.prisma.ropaActivity.findUnique);

      kit.prisma.ropaActivity.create.mockImplementation((async () =>
        makeActivity()) as unknown as typeof kit.prisma.ropaActivity.create);
      kit.prisma.ropaActivityVersion.create.mockImplementation((async () =>
        makeVersion()) as unknown as typeof kit.prisma.ropaActivityVersion.create);

      const result = await kit.service.seedDefaults(actor);
      expect(result.skipped).toContain(existingSlug);
      expect(result.created.length).toBe(ROPA_SEED_BLUEPRINTS.length - 1);
    });
  });

  // ---------------- patchVersion ----------------
  describe('patchVersion', () => {
    it('refuses non-DRAFT with 409 ROPA_NOT_EDITABLE', async () => {
      const kit = buildKit();
      kit.prisma.ropaActivityVersion.findFirst.mockResolvedValueOnce(
        makeVersion({ status: 'REVIEW' }),
      );
      await expect(
        kit.service.patchVersion(makeActor(), 'a-1', 'v-1', { name: 'new' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(kit.prisma.ropaActivityVersion.update).not.toHaveBeenCalled();
    });

    it('no-ops empty patch (returns current row without writing)', async () => {
      const kit = buildKit();
      const current = makeVersion();
      kit.prisma.ropaActivityVersion.findFirst.mockResolvedValueOnce(current);
      const result = await kit.service.patchVersion(makeActor(), 'a-1', 'v-1', {});
      expect(result).toBe(current);
      expect(kit.prisma.ropaActivityVersion.update).not.toHaveBeenCalled();
    });

    it('writes update + audit for the patched fields only', async () => {
      const kit = buildKit();
      const current = makeVersion();
      const updated = makeVersion({ name: 'baru' });
      kit.prisma.ropaActivityVersion.findFirst.mockResolvedValueOnce(current);
      kit.prisma.ropaActivityVersion.update.mockResolvedValueOnce(updated);
      const result = await kit.service.patchVersion(makeActor(), 'a-1', 'v-1', {
        name: 'baru',
      });
      expect(result.name).toBe('baru');
      expect(kit.prisma.ropaActivityVersion.update).toHaveBeenCalledWith({
        where: { id: 'v-1' },
        data: { name: 'baru' },
      });
      expect(kit.prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'ROPA_VERSION_UPDATED' }),
        }),
      );
    });
  });

  // ---------------- submitReview / returnToDraft ----------------
  describe('status transitions', () => {
    it('DRAFT → REVIEW writes reviewedAt/reviewedById + audit', async () => {
      const kit = buildKit();
      const current = makeVersion({ status: 'DRAFT' });
      const updated = makeVersion({ status: 'REVIEW', reviewedById: 'actor-1' });
      kit.prisma.ropaActivityVersion.findFirst.mockResolvedValueOnce(current);
      kit.prisma.ropaActivityVersion.update.mockResolvedValueOnce(updated);
      const result = await kit.service.submitReview(makeActor(), 'a-1', 'v-1');
      expect(result.status).toBe('REVIEW');
      const call = kit.prisma.ropaActivityVersion.update.mock.calls[0]?.[0] as {
        data: { status: string; reviewedById: string };
      };
      expect(call.data.status).toBe('REVIEW');
      expect(call.data.reviewedById).toBe('actor-1');
    });

    it('publish from DRAFT throws 409 (must go through REVIEW)', async () => {
      const kit = buildKit();
      kit.prisma.ropaActivityVersion.findFirst.mockResolvedValueOnce(
        makeVersion({ status: 'DRAFT' }),
      );
      await expect(kit.service.publish(makeActor(), 'a-1', 'v-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('REVIEW → PUBLISHED archives previous published + points activity current', async () => {
      const kit = buildKit();
      const current = makeVersion({ status: 'REVIEW', version: 2, id: 'v-2' });
      const previous = makeVersion({ status: 'PUBLISHED', version: 1, id: 'v-1' });
      const published = makeVersion({
        status: 'PUBLISHED',
        version: 2,
        id: 'v-2',
        publishedById: 'actor-1',
      });

      kit.prisma.ropaActivityVersion.findFirst
        .mockResolvedValueOnce(current) // loadVersion for v-2
        .mockResolvedValueOnce(previous); // find previous published
      kit.prisma.ropaActivityVersion.update
        .mockResolvedValueOnce(previous) // archive previous
        .mockResolvedValueOnce(published); // publish current
      kit.prisma.ropaActivity.update.mockResolvedValueOnce(makeActivity());

      const result = await kit.service.publish(makeActor(), 'a-1', 'v-2');
      expect(result.status).toBe('PUBLISHED');
      const activityUpdate = kit.prisma.ropaActivity.update.mock.calls[0]?.[0] as {
        where: { id: string };
        data: { currentVersionId: string };
      };
      expect(activityUpdate.where.id).toBe('a-1');
      expect(activityUpdate.data.currentVersionId).toBe('v-2');
    });
  });

  // ---------------- newVersion ----------------
  describe('newVersion', () => {
    it('refuses when an open DRAFT/REVIEW already exists', async () => {
      const kit = buildKit();
      kit.prisma.ropaActivity.findFirst.mockResolvedValueOnce({
        ...makeActivity(),
        versions: [makeVersion({ status: 'DRAFT', id: 'draft' })],
      } as unknown as RopaActivity);
      await expect(kit.service.newVersion(makeActor(), 'a-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('forks from the latest version + increments version number', async () => {
      const kit = buildKit();
      const seed = makeVersion({
        version: 3,
        status: 'PUBLISHED',
        id: 'v-3',
      });
      kit.prisma.ropaActivity.findFirst.mockResolvedValueOnce({
        ...makeActivity(),
        versions: [seed],
      } as unknown as RopaActivity);
      const forked = makeVersion({ version: 4, id: 'v-4' });
      kit.prisma.ropaActivityVersion.create.mockResolvedValueOnce(forked);
      const result = await kit.service.newVersion(makeActor(), 'a-1');
      expect(result.version).toBe(4);
      const call = kit.prisma.ropaActivityVersion.create.mock.calls[0]?.[0] as {
        data: { version: number; name: string };
      };
      expect(call.data.version).toBe(4);
      expect(call.data.name).toBe(seed.name);
    });

    it('404 when activity missing', async () => {
      const kit = buildKit();
      kit.prisma.ropaActivity.findFirst.mockResolvedValueOnce(null);
      await expect(kit.service.newVersion(makeActor(), 'a-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
