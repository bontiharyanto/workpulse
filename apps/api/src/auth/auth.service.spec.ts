import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { PrismaService } from '../prisma/prisma.service';

import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

const baseUser = {
  id: 'user-1',
  email: 'e@a.test',
  companyId: 'company-1',
  departmentId: 'dep-1',
  role: 'EMPLOYEE' as const,
  passwordHash: '$argon2id$v=19$...',
  fullName: 'Test',
  employmentStatus: 'ACTIVE' as const,
  hiredAt: new Date(),
  supervisorId: null,
  timezone: null,
  mustChangePassword: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

function setup(): {
  service: AuthService;
  prisma: DeepMockProxy<PrismaService>;
  password: DeepMockProxy<PasswordService>;
  tokens: DeepMockProxy<TokenService>;
} {
  const prisma = mockDeep<PrismaService>();
  const password = mockDeep<PasswordService>();
  const tokens = mockDeep<TokenService>();
  mockReset(prisma);
  mockReset(password);
  mockReset(tokens);
  return { service: new AuthService(prisma, password, tokens), prisma, password, tokens };
}

describe('AuthService.login', () => {
  it('throws UNAUTHORIZED when email is unknown (and still runs verify for constant timing)', async () => {
    const { service, prisma, password } = setup();
    prisma.user.findFirst.mockResolvedValue(null);
    password.verify.mockResolvedValue(false);

    await expect(
      service.login({ email: 'missing@a.test', password: 'x' }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(password.verify).toHaveBeenCalledTimes(1);
  });

  it('throws UNAUTHORIZED when password does not match', async () => {
    const { service, prisma, password } = setup();
    prisma.user.findFirst.mockResolvedValue(baseUser as never);
    password.verify.mockResolvedValue(false);

    await expect(
      service.login({ email: baseUser.email, password: 'wrong' }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects TERMINATED / SUSPENDED users with UNAUTHORIZED', async () => {
    const { service, prisma, password } = setup();
    prisma.user.findFirst.mockResolvedValue({ ...baseUser, employmentStatus: 'TERMINATED' } as never);
    password.verify.mockResolvedValue(true);
    password.needsRehash.mockReturnValue(false);

    await expect(
      service.login({ email: baseUser.email, password: 'ok' }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('happy path: verifies password, skips rehash when not needed, issues tokens, writes audit', async () => {
    const { service, prisma, password, tokens } = setup();
    prisma.user.findFirst.mockResolvedValue(baseUser as never);
    password.verify.mockResolvedValue(true);
    password.needsRehash.mockReturnValue(false);
    tokens.issueForLogin.mockResolvedValue({
      accessToken: 'at',
      accessTokenExpiresIn: 900,
      refreshToken: 'rt',
      refreshTokenExpiresAt: new Date(Date.now() + 7 * 86400_000),
      refreshTokenRow: { id: 'row', familyId: 'fam' } as never,
    });
    prisma.auditLog.create.mockResolvedValue({} as never);

    const result = await service.login(
      { email: baseUser.email, password: 'ok' },
      { userAgent: 'jest', ip: '127.0.0.1' },
    );

    expect(result.user).toMatchObject({ id: baseUser.id, role: 'EMPLOYEE' });
    expect(result.tokens.accessToken).toBe('at');
    expect(tokens.issueForLogin).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'AUTH_LOGIN' }) }),
    );
  });

  it('opportunistically rehashes when parameters are below policy', async () => {
    const { service, prisma, password, tokens } = setup();
    prisma.user.findFirst.mockResolvedValue(baseUser as never);
    password.verify.mockResolvedValue(true);
    password.needsRehash.mockReturnValue(true);
    password.hash.mockResolvedValue('$argon2id$v=19$new...');
    tokens.issueForLogin.mockResolvedValue({
      accessToken: 'at',
      accessTokenExpiresIn: 900,
      refreshToken: 'rt',
      refreshTokenExpiresAt: new Date(Date.now() + 7 * 86400_000),
      refreshTokenRow: { id: 'row' } as never,
    });

    await service.login({ email: baseUser.email, password: 'ok' }, {});

    expect(password.hash).toHaveBeenCalledWith('ok');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { passwordHash: '$argon2id$v=19$new...' } }),
    );
  });

  it('normalizes email (trim + lowercase) before lookup', async () => {
    const { service, prisma, password } = setup();
    prisma.user.findFirst.mockResolvedValue(null);
    password.verify.mockResolvedValue(false);

    await expect(
      service.login({ email: '  MiXed@Case.TEST  ', password: 'x' }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ email: 'mixed@case.test' }) }),
    );
  });
});

describe('AuthService.logout*', () => {
  it('logout is a no-op when no cookie is present', async () => {
    const { service, tokens } = setup();
    await service.logout(undefined);
    expect(tokens.revokeByRaw).not.toHaveBeenCalled();
  });

  it('logout delegates to tokens.revokeByRaw', async () => {
    const { service, tokens } = setup();
    await service.logout('opaque');
    expect(tokens.revokeByRaw).toHaveBeenCalledWith('opaque');
  });

  it('logoutAllDevices revokes all active tokens for user', async () => {
    const { service, tokens } = setup();
    await service.logoutAllDevices('user-1');
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith('user-1', 'USER_LOGOUT_ALL');
  });
});

// ---------------------------------------------------------------------------
// changePassword — self-service rotation (Fase 27)
// ---------------------------------------------------------------------------

/**
 * Shim `prisma.$transaction(cb)` so it runs the callback with `prisma` as tx.
 * Keeps the tests focused on business logic instead of Prisma plumbing.
 */
function withTx(prisma: DeepMockProxy<PrismaService>): void {
  prisma.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: unknown) => Promise<unknown>)(prisma);
    }
    return arg;
  });
}

describe('AuthService.changePassword', () => {
  it('rejects when current and new password are identical', async () => {
    const { service } = setup();
    await expect(
      service.changePassword(
        { userId: 'u-1', currentPassword: 'same-pw-123', newPassword: 'same-pw-123' },
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws INVALID_CREDENTIALS for unknown user (does not leak existence)', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.changePassword(
        { userId: 'ghost', currentPassword: 'x'.repeat(8), newPassword: 'y'.repeat(8) },
        {},
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws INVALID_CREDENTIALS when current password does not match', async () => {
    const { service, prisma, password } = setup();
    prisma.user.findFirst.mockResolvedValue(baseUser as never);
    password.verify.mockResolvedValue(false);

    await expect(
      service.changePassword(
        { userId: baseUser.id, currentPassword: 'wrong-pw', newPassword: 'newpass1' },
        {},
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('happy path: updates hash, clears mustChangePassword, audits, revokes all tokens', async () => {
    const { service, prisma, password, tokens } = setup();
    prisma.user.findFirst.mockResolvedValue({ ...baseUser, mustChangePassword: true } as never);
    password.verify.mockResolvedValue(true);
    password.hash.mockResolvedValue('$argon2id$v=19$new...');
    withTx(prisma);
    prisma.user.update.mockResolvedValue({} as never);
    prisma.auditLog.create.mockResolvedValue({} as never);

    await service.changePassword(
      { userId: baseUser.id, currentPassword: 'oldpass1', newPassword: 'newpass1' },
      { userAgent: 'jest', ip: '10.0.0.1' },
    );

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: baseUser.id },
        data: expect.objectContaining({
          passwordHash: '$argon2id$v=19$new...',
          mustChangePassword: false,
        }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'AUTH_PASSWORD_CHANGED',
          entityType: 'User',
          entityId: baseUser.id,
          userAgent: 'jest',
          ip: '10.0.0.1',
        }),
      }),
    );
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith(baseUser.id, 'PASSWORD_CHANGED_SELF');
  });

  it('does not touch tokens if the transaction (update/audit) fails', async () => {
    const { service, prisma, password, tokens } = setup();
    prisma.user.findFirst.mockResolvedValue(baseUser as never);
    password.verify.mockResolvedValue(true);
    password.hash.mockResolvedValue('$argon2id$v=19$new...');
    prisma.$transaction.mockRejectedValue(new Error('db down'));

    await expect(
      service.changePassword(
        { userId: baseUser.id, currentPassword: 'oldpass1', newPassword: 'newpass1' },
        {},
      ),
    ).rejects.toThrow('db down');

    expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
  });
});
