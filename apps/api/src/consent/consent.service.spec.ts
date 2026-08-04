import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrivacyPolicy, UserConsent } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { PrismaService } from '../prisma/prisma.service';

import { ConsentService } from './consent.service';

interface Kit {
  service: ConsentService;
  prisma: DeepMockProxy<PrismaService>;
}

function buildKit(): Kit {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  const service = new ConsentService(prisma);
  return { service, prisma };
}

function makePolicy(overrides: Partial<PrivacyPolicy> = {}): PrivacyPolicy {
  return {
    id: 'pol-1',
    companyId: 'c-1',
    version: '1.0',
    title: 'Kebijakan Privasi',
    body: 'Isi kebijakan.',
    effectiveAt: new Date('2026-07-01T00:00:00Z'),
    publishedById: 'admin-1',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

function makeConsent(overrides: Partial<UserConsent> = {}): UserConsent {
  return {
    id: 'con-1',
    userId: 'u-1',
    policyId: 'pol-1',
    companyId: 'c-1',
    acceptedAt: new Date('2026-08-02T00:00:00Z'),
    ip: null,
    userAgent: null,
    ...overrides,
  };
}

describe('ConsentService.getLatestForCompany', () => {
  it('returns the newest already-effective policy', async () => {
    const { service, prisma } = buildKit();
    const policy = makePolicy();
    prisma.privacyPolicy.findFirst.mockResolvedValue(policy);

    const result = await service.getLatestForCompany('c-1');

    expect(result).toBe(policy);
    const args = prisma.privacyPolicy.findFirst.mock.calls[0]?.[0];
    expect(args).toMatchObject({
      where: { companyId: 'c-1', effectiveAt: { lte: expect.any(Date) } },
      orderBy: { effectiveAt: 'desc' },
    });
  });
});

describe('ConsentService.getPendingConsentForUser', () => {
  it('returns null when the latest policy is already accepted', async () => {
    const { service, prisma } = buildKit();
    prisma.privacyPolicy.findFirst.mockResolvedValue(makePolicy());
    prisma.userConsent.findUnique.mockResolvedValue(makeConsent());

    const result = await service.getPendingConsentForUser('u-1', 'c-1');

    expect(result).toBeNull();
  });

  it('returns the policy when the user has not accepted yet', async () => {
    const { service, prisma } = buildKit();
    const policy = makePolicy();
    prisma.privacyPolicy.findFirst.mockResolvedValue(policy);
    prisma.userConsent.findUnique.mockResolvedValue(null);

    const result = await service.getPendingConsentForUser('u-1', 'c-1');

    expect(result).toBe(policy);
  });
});

describe('ConsentService.accept', () => {
  it('creates a consent row + audit entry in a single transaction', async () => {
    const { service, prisma } = buildKit();
    const policy = makePolicy();
    prisma.privacyPolicy.findUnique.mockResolvedValue(policy);

    const tx = {
      userConsent: { create: jest.fn().mockResolvedValue(makeConsent()) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === 'function') {
        return (cb as (t: unknown) => unknown)(tx);
      }
      return undefined;
    });

    const result = await service.accept('u-1', 'c-1', 'pol-1');

    expect(result.userId).toBe('u-1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((tx.auditLog.create as any).mock.calls[0][0].data).toMatchObject({
      action: 'CONSENT_ACCEPTED',
      entityType: 'PrivacyPolicy',
      entityId: 'pol-1',
    });
  });

  it('404s when the policy id belongs to another tenant', async () => {
    const { service, prisma } = buildKit();
    prisma.privacyPolicy.findUnique.mockResolvedValue(makePolicy({ companyId: 'other-tenant' }));

    await expect(service.accept('u-1', 'c-1', 'pol-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409s when the policy has a future effectiveAt', async () => {
    const { service, prisma } = buildKit();
    prisma.privacyPolicy.findUnique.mockResolvedValue(
      makePolicy({
        effectiveAt: new Date(Date.now() + 60 * 60_000),
      }),
    );

    await expect(service.accept('u-1', 'c-1', 'pol-1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ConsentService.publish', () => {
  it('creates the version and emits an audit row', async () => {
    const { service, prisma } = buildKit();
    const created = makePolicy({ version: '2.0' });

    const tx = {
      privacyPolicy: { create: jest.fn().mockResolvedValue(created) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === 'function') {
        return (cb as (t: unknown) => unknown)(tx);
      }
      return undefined;
    });

    const result = await service.publish(
      { id: 'admin-1', companyId: 'c-1', role: 'HR_MANAGER' },
      { version: '2.0', title: 'Baru', body: 'body' },
    );

    expect(result.version).toBe('2.0');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((tx.auditLog.create as any).mock.calls[0][0].data).toMatchObject({
      action: 'POLICY_PUBLISHED',
      entityType: 'PrivacyPolicy',
    });
  });

  it('409s when the version already exists for this tenant', async () => {
    const { service, prisma } = buildKit();

    const tx = {
      privacyPolicy: {
        create: jest.fn().mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' })),
      },
      auditLog: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === 'function') {
        return (cb as (t: unknown) => unknown)(tx);
      }
      return undefined;
    });

    await expect(
      service.publish(
        { id: 'admin-1', companyId: 'c-1', role: 'HR_MANAGER' },
        { version: '1.0', title: 'x', body: 'y' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
