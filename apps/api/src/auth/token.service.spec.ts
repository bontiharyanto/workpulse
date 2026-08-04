import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { RefreshTokenStatus } from '@prisma/client';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { PrismaService } from '../prisma/prisma.service';
import { hashRefreshSecret } from './domain/token-hash';
import { TokenService } from './token.service';

const userRow = {
  id: 'user-1',
  email: 'e@a.test',
  companyId: 'company-1',
  departmentId: 'dep-1',
  role: 'EMPLOYEE' as const,
  passwordHash: 'x',
  fullName: 'Test',
  employmentStatus: 'ACTIVE' as const,
  hiredAt: new Date(),
  supervisorId: null,
  timezone: null,
  mustChangePassword: false,
  mfaSecret: null,
  mfaEnabledAt: null,
  overtimeHourlyRate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

function buildTokenService(): {
  service: TokenService;
  prisma: DeepMockProxy<PrismaService>;
  jwt: DeepMockProxy<JwtService>;
} {
  const prisma = mockDeep<PrismaService>();
  const jwt = mockDeep<JwtService>();
  const config = {
    get: jest.fn((key: string, def?: unknown) =>
      key === 'JWT_EXPIRES_IN' ? '15m' : key === 'JWT_REFRESH_EXPIRES_IN' ? '7d' : def,
    ),
  } as unknown as ConfigService;

  jwt.sign.mockReturnValue('signed.jwt.token');
  mockReset(prisma);

  const service = new TokenService(prisma, jwt, config);
  return { service, prisma, jwt };
}

describe('TokenService.issueForLogin', () => {
  it('signs an access JWT and stores a hashed refresh with familyId=row.id', async () => {
    const { service, prisma, jwt } = buildTokenService();

    const createdRow = {
      id: 'rt-1',
      userId: userRow.id,
      familyId: '__pending__',
      tokenHash: 'placeholder',
      status: RefreshTokenStatus.ACTIVE,
      replacedById: null,
      userAgent: null,
      ip: null,
      expiresAt: new Date(Date.now() + 7 * 86400_000),
      mfaVerified: true,
      createdAt: new Date(),
      revokedAt: null,
    };
    prisma.refreshToken.create.mockResolvedValue(createdRow as never);
    prisma.refreshToken.update.mockResolvedValue({ ...createdRow, familyId: 'rt-1' } as never);
    jwt.sign.mockReturnValue('signed.jwt.token');

    const pair = await service.issueForLogin(
      userRow,
      { userAgent: 'jest', ip: '127.0.0.1' },
      { mfaPassed: true },
    );

    expect(pair.accessToken).toBe('signed.jwt.token');
    expect(pair.refreshToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(prisma.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: userRow.id,
          familyId: '__pending__',
          tokenHash: hashRefreshSecret(pair.refreshToken),
        }),
      }),
    );
    expect(prisma.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'rt-1' }, data: { familyId: 'rt-1' } }),
    );
    expect(pair.refreshTokenRow.familyId).toBe('rt-1');
  });
});

describe('TokenService.rotate', () => {
  it('throws UNAUTHORIZED when the token is unknown', async () => {
    const { service, prisma } = buildTokenService();
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    await expect(service.rotate('bogus', {})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('detects reuse and revokes the entire family', async () => {
    const { service, prisma } = buildTokenService();
    const rotated = {
      id: 'rt-1',
      userId: userRow.id,
      familyId: 'fam-1',
      tokenHash: 'h',
      status: RefreshTokenStatus.ROTATED,
      replacedById: 'rt-2',
      userAgent: null,
      ip: null,
      expiresAt: new Date(Date.now() + 86400_000),
      mfaVerified: true,
      createdAt: new Date(),
      revokedAt: null,
      user: userRow,
    };
    prisma.refreshToken.findUnique.mockResolvedValue(rotated as never);
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 } as never);

    await expect(service.rotate('any', {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ familyId: 'fam-1' }),
        data: expect.objectContaining({ status: RefreshTokenStatus.REVOKED }),
      }),
    );
  });

  it('rejects expired tokens and marks them revoked', async () => {
    const { service, prisma } = buildTokenService();
    const expired = {
      id: 'rt-x',
      userId: userRow.id,
      familyId: 'fam-x',
      tokenHash: 'h',
      status: RefreshTokenStatus.ACTIVE,
      replacedById: null,
      userAgent: null,
      ip: null,
      expiresAt: new Date(Date.now() - 1000),
      mfaVerified: true,
      createdAt: new Date(),
      revokedAt: null,
      user: userRow,
    };
    prisma.refreshToken.findUnique.mockResolvedValue(expired as never);
    prisma.refreshToken.update.mockResolvedValue(expired as never);

    await expect(service.rotate('any', {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rt-x' },
        data: expect.objectContaining({ status: RefreshTokenStatus.REVOKED }),
      }),
    );
  });

  it('successfully rotates: marks old ROTATED, links replacedById, issues new pair', async () => {
    const { service, prisma } = buildTokenService();

    const active = {
      id: 'rt-old',
      userId: userRow.id,
      familyId: 'fam-1',
      tokenHash: 'h',
      status: RefreshTokenStatus.ACTIVE,
      replacedById: null,
      userAgent: null,
      ip: null,
      expiresAt: new Date(Date.now() + 86400_000),
      mfaVerified: true,
      createdAt: new Date(),
      revokedAt: null,
      user: userRow,
    };
    prisma.refreshToken.findUnique.mockResolvedValue(active as never);

    const newRow = {
      id: 'rt-new',
      userId: userRow.id,
      familyId: 'fam-1',
      tokenHash: 'h2',
      status: RefreshTokenStatus.ACTIVE,
      replacedById: null,
      userAgent: null,
      ip: null,
      expiresAt: new Date(Date.now() + 7 * 86400_000),
      mfaVerified: true,
      createdAt: new Date(),
      revokedAt: null,
    };
    prisma.refreshToken.create.mockResolvedValue(newRow as never);
    prisma.refreshToken.update.mockResolvedValue(newRow as never);

    type TxCallback = (tx: PrismaService) => Promise<unknown>;
    prisma.$transaction.mockImplementation(((cb: TxCallback) => cb(prisma)) as never);

    const pair = await service.rotate('valid-secret', { userAgent: 'ua', ip: '1.2.3.4' });

    expect(pair.accessToken).toBe('signed.jwt.token');
    expect(pair.refreshToken).toBeTruthy();
    expect(prisma.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rt-old' },
        data: expect.objectContaining({
          status: RefreshTokenStatus.ROTATED,
          replacedById: 'rt-new',
        }),
      }),
    );
  });
});

describe('TokenService.revoke*', () => {
  it('revokeByRaw is a no-op for unknown tokens', async () => {
    const { service, prisma } = buildTokenService();
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    await expect(service.revokeByRaw('x')).resolves.toBeUndefined();
    expect(prisma.refreshToken.update).not.toHaveBeenCalled();
  });

  it('revokeAllForUser marks every ACTIVE row as REVOKED', async () => {
    const { service, prisma } = buildTokenService();
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 } as never);
    await service.revokeAllForUser('user-1', 'password-change');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', status: RefreshTokenStatus.ACTIVE },
        data: expect.objectContaining({ status: RefreshTokenStatus.REVOKED }),
      }),
    );
  });
});
