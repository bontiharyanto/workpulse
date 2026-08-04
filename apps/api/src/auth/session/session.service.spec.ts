import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma, RefreshToken } from '@prisma/client';
import { RefreshTokenStatus } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { PrismaService } from '../../prisma/prisma.service';

import { hashRefreshSecret } from '../domain/token-hash';
import { SessionService } from './session.service';

interface Kit {
  service: SessionService;
  prisma: DeepMockProxy<PrismaService>;
}

function buildKit(): Kit {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  return { service: new SessionService(prisma), prisma };
}

function makeRow(overrides: Partial<RefreshToken> = {}): RefreshToken {
  return {
    id: 'row-1',
    userId: 'user-1',
    familyId: 'row-1',
    tokenHash: 'hash-1',
    status: RefreshTokenStatus.ACTIVE,
    replacedById: null,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
    ip: '203.0.113.5',
    expiresAt: new Date(Date.now() + 86_400_000),
    mfaVerified: true,
    createdAt: new Date('2026-08-01T10:00:00Z'),
    revokedAt: null,
    ...overrides,
  };
}

describe('SessionService', () => {
  describe('list', () => {
    it('returns ACTIVE sessions newest-first with isCurrent marked for the caller cookie', async () => {
      const { service, prisma } = buildKit();
      const rawCookie = 'my-refresh-secret';
      const currentHash = hashRefreshSecret(rawCookie);
      const rows = [
        makeRow({ id: 'a', tokenHash: 'other-hash' }),
        makeRow({ id: 'b', tokenHash: currentHash }),
      ];
      prisma.refreshToken.findMany.mockResolvedValue(rows);

      const out = await service.list('user-1', rawCookie);
      expect(prisma.refreshToken.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          status: RefreshTokenStatus.ACTIVE,
          expiresAt: { gt: expect.any(Date) },
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(out).toHaveLength(2);
      expect(out.find((r) => r.id === 'a')?.isCurrent).toBe(false);
      expect(out.find((r) => r.id === 'b')?.isCurrent).toBe(true);
    });

    it('marks no row as current when caller has no refresh cookie', async () => {
      const { service, prisma } = buildKit();
      prisma.refreshToken.findMany.mockResolvedValue([makeRow()]);
      const out = await service.list('user-1');
      expect(out[0]?.isCurrent).toBe(false);
    });

    it('exposes safe metadata only — never the token hash', async () => {
      const { service, prisma } = buildKit();
      prisma.refreshToken.findMany.mockResolvedValue([makeRow({ tokenHash: 'super-secret-hash' })]);
      const out = await service.list('user-1');
      expect(out[0]).not.toHaveProperty('tokenHash');
      expect(Object.keys(out[0] ?? {})).toEqual([
        'id',
        'userAgent',
        'ip',
        'mfaVerified',
        'createdAt',
        'expiresAt',
        'isCurrent',
      ]);
    });
  });

  describe('revoke', () => {
    it('revokes an ACTIVE row belonging to the caller and audits it', async () => {
      const { service, prisma } = buildKit();
      const row = makeRow();
      prisma.refreshToken.findUnique.mockResolvedValue(row);
      // Simulate the transaction callback: pass a tx that mirrors prisma.
      prisma.$transaction.mockImplementation(async (cb: unknown) => {
        if (typeof cb === 'function') {
          return (cb as (tx: unknown) => unknown)(prisma);
        }
        throw new Error('unexpected transaction call shape');
      });
      prisma.user.findUnique.mockResolvedValue({ companyId: 'company-1' } as never);

      await service.revoke('user-1', row.id);

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: row.id },
        data: {
          status: RefreshTokenStatus.REVOKED,
          revokedAt: expect.any(Date),
        },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: 'company-1',
          actorId: 'user-1',
          action: 'SESSION_REVOKED',
          entityType: 'RefreshToken',
          entityId: row.id,
        }),
      });
    });

    it('404s when the id does not exist', async () => {
      const { service, prisma } = buildKit();
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.revoke('user-1', 'ghost')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s when the id belongs to another user (no existence leak)', async () => {
      const { service, prisma } = buildKit();
      prisma.refreshToken.findUnique.mockResolvedValue(makeRow({ userId: 'stranger' }));
      const err = await service.revoke('user-1', 'foreign').catch((e) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      const body = (err as NotFoundException).getResponse() as { code: string };
      expect(body.code).toBe('SESSION_NOT_FOUND');
    });

    it('403 when the row is already REVOKED (idempotency guard)', async () => {
      const { service, prisma } = buildKit();
      prisma.refreshToken.findUnique.mockResolvedValue(
        makeRow({ status: RefreshTokenStatus.REVOKED }),
      );
      const err = await service.revoke('user-1', 'row-1').catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      const body = (err as ForbiddenException).getResponse() as { code: string };
      expect(body.code).toBe('SESSION_ALREADY_REVOKED');
    });
  });

  describe('revokeOthers', () => {
    it('excludes the current session (by hash) and reports revoked count', async () => {
      const { service, prisma } = buildKit();
      const raw = 'this-tab';
      prisma.$transaction.mockImplementation(async (cb: unknown) => {
        if (typeof cb === 'function') {
          return (cb as (tx: unknown) => unknown)(prisma);
        }
        throw new Error('unexpected transaction call shape');
      });
      prisma.refreshToken.updateMany.mockResolvedValue({
        count: 3,
      } as Prisma.BatchPayload);
      prisma.user.findUnique.mockResolvedValue({ companyId: 'company-1' } as never);

      const out = await service.revokeOthers('user-1', raw);

      expect(out.revokedCount).toBe(3);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          status: RefreshTokenStatus.ACTIVE,
          tokenHash: { not: hashRefreshSecret(raw) },
        },
        data: {
          status: RefreshTokenStatus.REVOKED,
          revokedAt: expect.any(Date),
        },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'SESSION_REVOKED_OTHERS',
          afterJson: { count: 3 },
        }),
      });
    });

    it('sweeps every ACTIVE row when the caller has no cookie', async () => {
      const { service, prisma } = buildKit();
      prisma.$transaction.mockImplementation(async (cb: unknown) => {
        if (typeof cb === 'function') {
          return (cb as (tx: unknown) => unknown)(prisma);
        }
        throw new Error('unexpected transaction call shape');
      });
      prisma.refreshToken.updateMany.mockResolvedValue({
        count: 5,
      } as Prisma.BatchPayload);
      prisma.user.findUnique.mockResolvedValue({ companyId: 'company-1' } as never);

      await service.revokeOthers('user-1');

      const args = prisma.refreshToken.updateMany.mock.calls[0]?.[0];
      expect(args?.where).toEqual({
        userId: 'user-1',
        status: RefreshTokenStatus.ACTIVE,
      });
    });

    it('skips the audit write when nothing was revoked', async () => {
      const { service, prisma } = buildKit();
      prisma.$transaction.mockImplementation(async (cb: unknown) => {
        if (typeof cb === 'function') {
          return (cb as (tx: unknown) => unknown)(prisma);
        }
        throw new Error('unexpected transaction call shape');
      });
      prisma.refreshToken.updateMany.mockResolvedValue({
        count: 0,
      } as Prisma.BatchPayload);

      const out = await service.revokeOthers('user-1', 'raw');
      expect(out.revokedCount).toBe(0);
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });
});
