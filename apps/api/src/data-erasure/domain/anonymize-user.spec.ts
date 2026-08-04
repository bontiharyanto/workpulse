import type { Prisma } from '@prisma/client';

import { anonymizeUser } from './anonymize-user';

/**
 * Builds a fake Prisma transaction client that satisfies the subset of
 * calls made by `anonymizeUser`. Because the helper is pure DB glue,
 * we can drive it entirely from mocks and assert on the calls.
 */
function makeTx(overrides: Record<string, unknown> = {}) {
  const calls: Record<string, unknown[]> = {};

  function record(name: string) {
    return (arg: unknown) => {
      calls[name] = calls[name] ?? [];
      calls[name]!.push(arg);
    };
  }

  const tx: unknown = {
    mfaBackupCode: {
      deleteMany: jest.fn(async (arg) => {
        record('mfaBackupCode.deleteMany')(arg);
        return { count: 2 };
      }),
    },
    passwordResetToken: {
      deleteMany: jest.fn(async (arg) => {
        record('passwordResetToken.deleteMany')(arg);
        return { count: 1 };
      }),
    },
    notificationPreference: {
      deleteMany: jest.fn(async (arg) => {
        record('notificationPreference.deleteMany')(arg);
        return { count: 3 };
      }),
    },
    notification: {
      deleteMany: jest.fn(async (arg) => {
        record('notification.deleteMany')(arg);
        return { count: 5 };
      }),
    },
    refreshToken: {
      updateMany: jest.fn(async (arg) => {
        record('refreshToken.updateMany')(arg);
        return { count: 4 };
      }),
    },
    dataExportRequest: {
      findMany: jest.fn(async () => [
        { id: 'exp-1', fileKey: 'data-exports/x.zip' },
        { id: 'exp-2', fileKey: null },
      ]),
      updateMany: jest.fn(async (arg) => {
        record('dataExportRequest.updateMany')(arg);
        return { count: 2 };
      }),
    },
    user: {
      update: jest.fn(async (arg) => {
        record('user.update')(arg);
        return {} as unknown;
      }),
    },
    ...overrides,
    __calls: calls,
  };
  return tx as Prisma.TransactionClient & { __calls: typeof calls };
}

describe('anonymizeUser', () => {
  const now = new Date('2026-08-02T10:00:00.000Z');

  it('replaces personal fields on the user row and returns metadata', async () => {
    const tx = makeTx();
    const result = await anonymizeUser(tx, {
      userId: 'user-1',
      companyId: 'company-1',
      erasureRequestId: 'era-1',
      now,
    });

    expect(result.erasedEmail).toBe('erased-user-1@workpulse.deleted');
    expect(result.refreshTokensRevoked).toBe(4);
    expect(result.backupCodesDeleted).toBe(2);
    expect(result.notificationsDeleted).toBe(5);
    expect(result.passwordResetsDeleted).toBe(1);
    expect(result.notificationPrefsDeleted).toBe(3);
    expect(result.dataExportFileKeys).toEqual(['data-exports/x.zip']);

    const [userCall] = (tx as unknown as { __calls: Record<string, unknown[]> })
      .__calls['user.update']!;
    expect(userCall).toMatchObject({
      where: { id: 'user-1' },
      data: expect.objectContaining({
        email: 'erased-user-1@workpulse.deleted',
        fullName: 'Erased User',
        mfaSecret: null,
        mfaEnabledAt: null,
        mustChangePassword: false,
        employmentStatus: 'TERMINATED',
        deletedAt: now,
      }),
    });
    // Guard against accidentally storing a decipherable hash.
    const passwordHash = (
      userCall as { data: { passwordHash: string } }
    ).data.passwordHash;
    expect(passwordHash).toHaveLength(128);
    expect(/^[0-9a-f]+$/.test(passwordHash)).toBe(true);
  });

  it('revokes only ACTIVE + ROTATED refresh tokens', async () => {
    const tx = makeTx();
    await anonymizeUser(tx, {
      userId: 'user-1',
      companyId: 'company-1',
      erasureRequestId: 'era-1',
      now,
    });
    const [rtCall] = (tx as unknown as { __calls: Record<string, unknown[]> })
      .__calls['refreshToken.updateMany']!;
    expect(rtCall).toMatchObject({
      where: {
        userId: 'user-1',
        status: { in: ['ACTIVE', 'ROTATED'] },
      },
      data: { status: 'REVOKED', revokedAt: now },
    });
  });

  it('flips open exports to EXPIRED but keeps the rows for audit', async () => {
    const tx = makeTx();
    await anonymizeUser(tx, {
      userId: 'user-1',
      companyId: 'company-1',
      erasureRequestId: 'era-1',
      now,
    });
    const [expCall] = (tx as unknown as { __calls: Record<string, unknown[]> })
      .__calls['dataExportRequest.updateMany']!;
    expect(expCall).toMatchObject({
      where: { id: { in: ['exp-1', 'exp-2'] } },
      data: { status: 'EXPIRED', fileKey: null },
    });
  });
});
