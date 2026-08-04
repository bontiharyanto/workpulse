import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';

import { hashResetToken } from './domain/reset-token';
import { PasswordService } from './password.service';
import { PasswordResetService } from './password-reset.service';

type EmailAdapterMock = {
  send: jest.Mock;
  transport: string;
};

function setup(): {
  service: PasswordResetService;
  prisma: DeepMockProxy<PrismaService>;
  password: DeepMockProxy<PasswordService>;
  notifications: DeepMockProxy<NotificationService>;
  config: DeepMockProxy<ConfigService>;
  email: EmailAdapterMock;
} {
  const prisma = mockDeep<PrismaService>();
  const password = mockDeep<PasswordService>();
  const notifications = mockDeep<NotificationService>();
  const config = mockDeep<ConfigService>();
  const email: EmailAdapterMock = {
    send: jest.fn().mockResolvedValue(undefined),
    transport: 'test',
  };
  mockReset(prisma);
  mockReset(password);
  mockReset(notifications);
  mockReset(config);
  email.send.mockClear();
  config.get.mockImplementation((key: string, fallback?: unknown) =>
    key === 'WEB_URL' ? 'https://app.workpulse.local' : (fallback as never),
  );
  const service = new PasswordResetService(
    prisma,
    password,
    notifications,
    config,
    email as never,
  );
  return { service, prisma, password, notifications, config, email };
}

const baseUser = {
  id: 'user-1',
  email: 'ana@example.com',
  companyId: 'company-1',
  fullName: 'Ana',
  employmentStatus: 'ACTIVE' as const,
  deletedAt: null as Date | null,
};

describe('PasswordResetService.requestReset', () => {
  it('creates a token row + sends an email when the user is found', async () => {
    const s = setup();
    s.prisma.user.findFirst.mockResolvedValue(baseUser as never);
    s.prisma.passwordResetToken.create.mockResolvedValue({} as never);

    await s.service.requestReset({
      email: 'ANA@example.com  ',
      ipAddress: '10.0.0.1',
      userAgent: 'Mozilla/5.0',
    });

    expect(s.prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ email: 'ana@example.com' }),
      }),
    );
    expect(s.prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
    const firstCreate = s.prisma.passwordResetToken.create.mock.calls[0];
    if (!firstCreate) throw new Error('passwordResetToken.create was not invoked');
    const created = firstCreate[0];
    expect(created.data.userId).toBe(baseUser.id);
    expect(created.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect((created.data.expiresAt as Date).getTime()).toBeGreaterThan(Date.now());
    expect(created.data.requestedIp).toBe('10.0.0.1');
    expect(created.data.requestedUserAgent).toBe('Mozilla/5.0');
    // Email is scheduled but the promise chain runs in background; give it a tick.
    await new Promise((r) => setImmediate(r));
    expect(s.email.send).toHaveBeenCalledTimes(1);
    const firstSend = s.email.send.mock.calls[0];
    if (!firstSend) throw new Error('email.send was not invoked');
    const sent = firstSend[0];
    expect(sent.to).toBe('ana@example.com');
    expect(sent.subject).toBe('Reset password Workpulse');
    expect(sent.body).toContain('reset-password?token=');
    expect(sent.body).toContain('https://app.workpulse.local');
  });

  it('does not disclose whether the account exists (unknown email → silent success)', async () => {
    const s = setup();
    s.prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      s.service.requestReset({ email: 'ghost@nowhere.test' }),
    ).resolves.toBeUndefined();
    expect(s.prisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(s.email.send).not.toHaveBeenCalled();
  });

  it('does not disclose whether the account is TERMINATED / SUSPENDED', async () => {
    const s = setup();
    s.prisma.user.findFirst.mockResolvedValue({
      ...baseUser,
      employmentStatus: 'TERMINATED',
    } as never);

    await expect(
      s.service.requestReset({ email: baseUser.email }),
    ).resolves.toBeUndefined();
    expect(s.prisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('swallows email-transport errors so a broken SMTP does not leak the account state', async () => {
    const s = setup();
    s.prisma.user.findFirst.mockResolvedValue(baseUser as never);
    s.prisma.passwordResetToken.create.mockResolvedValue({} as never);
    s.email.send.mockRejectedValueOnce(new Error('SMTP down'));

    await expect(
      s.service.requestReset({ email: baseUser.email }),
    ).resolves.toBeUndefined();
  });
});

describe('PasswordResetService.resetPassword', () => {
  const rawToken = 'A'.repeat(64);
  const validTokenHash = hashResetToken(rawToken);

  function makeTokenRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'reset-1',
      userId: baseUser.id,
      tokenHash: validTokenHash,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      usedAt: null as Date | null,
      user: baseUser,
      ...overrides,
    };
  }

  function stubTransactionSuccess(s: ReturnType<typeof setup>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s.prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx: any = {
        passwordResetToken: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        user: { update: jest.fn().mockResolvedValue({}) },
        refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      };
      const result = await cb(tx);
      // Expose tx to the test via property so we can assert against it.
      (s.prisma as unknown as { __lastTx: unknown }).__lastTx = tx;
      return result;
    });
  }

  it('rejects malformed tokens without touching the DB', async () => {
    const s = setup();
    await expect(
      s.service.resetPassword({ rawToken: 'not-a-token!!', newPassword: 'x'.repeat(12) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(s.prisma.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });

  it('rejects tokens that were never issued', async () => {
    const s = setup();
    s.prisma.passwordResetToken.findUnique.mockResolvedValue(null);
    await expect(
      s.service.resetPassword({ rawToken, newPassword: 'p'.repeat(12) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects already-used tokens', async () => {
    const s = setup();
    s.prisma.passwordResetToken.findUnique.mockResolvedValue(
      makeTokenRow({ usedAt: new Date() }) as never,
    );
    await expect(
      s.service.resetPassword({ rawToken, newPassword: 'p'.repeat(12) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects expired tokens', async () => {
    const s = setup();
    s.prisma.passwordResetToken.findUnique.mockResolvedValue(
      makeTokenRow({ expiresAt: new Date(Date.now() - 1000) }) as never,
    );
    await expect(
      s.service.resetPassword({ rawToken, newPassword: 'p'.repeat(12) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects tokens whose owner was soft-deleted or deactivated', async () => {
    const s = setup();
    s.prisma.passwordResetToken.findUnique.mockResolvedValue(
      makeTokenRow({
        user: { ...baseUser, employmentStatus: 'TERMINATED' },
      }) as never,
    );
    await expect(
      s.service.resetPassword({ rawToken, newPassword: 'p'.repeat(12) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates password, revokes refresh tokens, writes audit log + notification on success', async () => {
    const s = setup();
    s.prisma.passwordResetToken.findUnique.mockResolvedValue(makeTokenRow() as never);
    s.password.hash.mockResolvedValue('$argon2id$hash');
    stubTransactionSuccess(s);
    s.prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 } as never);

    await s.service.resetPassword({
      rawToken,
      newPassword: 'NewStrong123!',
      ipAddress: '10.0.0.2',
      userAgent: 'Chrome',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = (s.prisma as any).__lastTx as any;
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: baseUser.id },
        data: expect.objectContaining({
          passwordHash: '$argon2id$hash',
          // Fase 27 — email-based reset also clears the temp-password
          // enforcement flag, so a user who forgot their admin-issued
          // temp password can pick their own and skip /change-password.
          mustChangePassword: false,
        }),
      }),
    );
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: baseUser.id, status: 'ACTIVE' }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'AUTH_PASSWORD_RESET',
          actorId: baseUser.id,
          ip: '10.0.0.2',
        }),
      }),
    );
    expect(s.notifications.createOne).toHaveBeenCalledTimes(1);
    const firstCall = s.notifications.createOne.mock.calls[0];
    if (!firstCall) throw new Error('notifications.createOne was not invoked');
    const call = firstCall[0];
    expect(call.content.type).toBe('PASSWORD_RESET');
    expect(call.recipientId).toBe(baseUser.id);
    expect(call.recipientEmail).toBe(baseUser.email);
    // Post-transaction cleanup runs.
    expect(s.prisma.passwordResetToken.updateMany).toHaveBeenCalled();
  });

  it('treats a lost race on token consumption as INVALID_TOKEN', async () => {
    const s = setup();
    s.prisma.passwordResetToken.findUnique.mockResolvedValue(makeTokenRow() as never);
    s.password.hash.mockResolvedValue('$argon2id$hash');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s.prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx: any = {
        passwordResetToken: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        user: { update: jest.fn() },
        refreshToken: { updateMany: jest.fn() },
        auditLog: { create: jest.fn() },
      };
      return cb(tx);
    });

    await expect(
      s.service.resetPassword({ rawToken, newPassword: 'p'.repeat(12) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
