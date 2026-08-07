import type { ConfigService } from '@nestjs/config';
import type { SecurityPolicy } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { SecurityPolicyService } from './security-policy.service';
import { PrismaService } from '../prisma/prisma.service';

interface Kit {
  service: SecurityPolicyService;
  prisma: DeepMockProxy<PrismaService>;
}

function buildKit(envMfaEnforce = false): Kit {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  const config = {
    get: jest.fn((key: string, def?: string) =>
      key === 'MFA_ENFORCE_HR_ADMIN' ? (envMfaEnforce ? 'true' : 'false') : def,
    ),
  } as unknown as ConfigService;
  const service = new SecurityPolicyService(prisma, config);
  return { service, prisma };
}

function makePolicy(overrides: Partial<SecurityPolicy> = {}): SecurityPolicy {
  return {
    id: 'sp-1',
    companyId: 'c-1',
    mfaEnforceHighPrivileged: false,
    updatedAt: new Date('2026-08-06T00:00:00Z'),
    updatedById: null,
    createdAt: new Date('2026-08-06T00:00:00Z'),
    ...overrides,
  };
}

describe('SecurityPolicyService.getForCompany', () => {
  it('returns existing row without materialising defaults', async () => {
    const { service, prisma } = buildKit();
    const row = makePolicy();
    prisma.securityPolicy.findUnique.mockResolvedValue(row);

    const result = await service.getForCompany('c-1');

    expect(result).toBe(row);
    expect(prisma.securityPolicy.upsert).not.toHaveBeenCalled();
  });

  it('materialises the row using env default when missing (env=true)', async () => {
    const { service, prisma } = buildKit(true);
    prisma.securityPolicy.findUnique.mockResolvedValue(null);
    prisma.securityPolicy.upsert.mockResolvedValue(makePolicy({ mfaEnforceHighPrivileged: true }));

    const result = await service.getForCompany('c-1');

    expect(result.mfaEnforceHighPrivileged).toBe(true);
    const upsertCall = prisma.securityPolicy.upsert.mock.calls[0];
    if (!upsertCall) throw new Error('expected upsert to be called');
    expect(upsertCall[0].create.mfaEnforceHighPrivileged).toBe(true);
  });

  it('materialises the row using env default when missing (env=false)', async () => {
    const { service, prisma } = buildKit(false);
    prisma.securityPolicy.findUnique.mockResolvedValue(null);
    prisma.securityPolicy.upsert.mockResolvedValue(makePolicy());

    await service.getForCompany('c-1');

    const upsertCall = prisma.securityPolicy.upsert.mock.calls[0];
    if (!upsertCall) throw new Error('expected upsert to be called');
    expect(upsertCall[0].create.mfaEnforceHighPrivileged).toBe(false);
  });

  it('caches consecutive reads within the TTL window', async () => {
    const { service, prisma } = buildKit();
    prisma.securityPolicy.findUnique.mockResolvedValue(makePolicy());

    await service.getForCompany('c-1');
    await service.getForCompany('c-1');
    await service.getForCompany('c-1');

    expect(prisma.securityPolicy.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('SecurityPolicyService.update', () => {
  it('returns current row when input body is empty', async () => {
    const { service, prisma } = buildKit();
    const row = makePolicy();
    prisma.securityPolicy.findUnique.mockResolvedValue(row);

    const result = await service.update({ id: 'u-1', companyId: 'c-1', role: 'SUPER_ADMIN' }, {});

    expect(result).toBe(row);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('applies the update inside a transaction and emits an audit log', async () => {
    const { service, prisma } = buildKit();
    const before = makePolicy({ mfaEnforceHighPrivileged: false });
    const after = makePolicy({
      mfaEnforceHighPrivileged: true,
      updatedById: 'u-1',
      updatedAt: new Date(),
    });

    const tx = mockDeep<PrismaService>();
    tx.securityPolicy.upsert.mockResolvedValue(before);
    tx.securityPolicy.update.mockResolvedValue(after);
    tx.auditLog.create.mockResolvedValue({} as never);
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb !== 'function') throw new Error('transaction expected a callback');
      return (cb as (t: typeof tx) => Promise<SecurityPolicy>)(tx);
    });

    const result = await service.update(
      { id: 'u-1', companyId: 'c-1', role: 'SUPER_ADMIN' },
      { mfaEnforceHighPrivileged: true },
    );

    expect(result.mfaEnforceHighPrivileged).toBe(true);
    expect(tx.securityPolicy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'c-1' },
        data: expect.objectContaining({
          mfaEnforceHighPrivileged: true,
          updatedById: 'u-1',
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'SECURITY_POLICY_UPDATED',
          entityType: 'SecurityPolicy',
          entityId: after.id,
        }),
      }),
    );
  });

  it('invalidates the cache so the next read sees the fresh value', async () => {
    const { service, prisma } = buildKit();
    const before = makePolicy({ mfaEnforceHighPrivileged: false });
    prisma.securityPolicy.findUnique.mockResolvedValue(before);
    await service.getForCompany('c-1'); // prime cache

    const tx = mockDeep<PrismaService>();
    tx.securityPolicy.upsert.mockResolvedValue(before);
    tx.securityPolicy.update.mockResolvedValue(makePolicy({ mfaEnforceHighPrivileged: true }));
    tx.auditLog.create.mockResolvedValue({} as never);
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb !== 'function') throw new Error('transaction expected a callback');
      return (cb as (t: typeof tx) => Promise<SecurityPolicy>)(tx);
    });

    await service.update(
      { id: 'u-1', companyId: 'c-1', role: 'SUPER_ADMIN' },
      { mfaEnforceHighPrivileged: true },
    );

    // Second read must re-fetch (cache invalidated).
    prisma.securityPolicy.findUnique.mockResolvedValueOnce(
      makePolicy({ mfaEnforceHighPrivileged: true }),
    );
    const fresh = await service.getForCompany('c-1');
    expect(fresh.mfaEnforceHighPrivileged).toBe(true);
    expect(prisma.securityPolicy.findUnique).toHaveBeenCalledTimes(2);
  });
});
