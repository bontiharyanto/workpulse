import {
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';
import { authenticator } from 'otplib';

import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../password.service';
import type { IssuedTokenPair } from '../token.service';
import { TokenService } from '../token.service';
import { hashBackupCode, normalizeBackupCode } from './domain/backup-codes';
import { decodeEncryptionKey, encryptString } from './domain/crypto';
import { MfaService } from './mfa.service';

const TEST_KEY_BASE64 = Buffer.alloc(32, 7).toString('base64');
const TEST_KEY = decodeEncryptionKey(TEST_KEY_BASE64);

const userRow = {
  id: 'user-1',
  email: 'jane@example.com',
  companyId: 'company-1',
  departmentId: 'dep-1',
  role: 'HR_MANAGER' as const,
  passwordHash: 'x',
  fullName: 'Jane',
  employmentStatus: 'ACTIVE' as const,
  hiredAt: new Date('2024-01-01T00:00:00Z'),
  supervisorId: null,
  timezone: null,
  mustChangePassword: false,
  mfaSecret: null as string | null,
  mfaEnabledAt: null as Date | null,
  overtimeHourlyRate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

interface Kit {
  service: MfaService;
  prisma: DeepMockProxy<PrismaService>;
  tokens: DeepMockProxy<TokenService>;
  password: DeepMockProxy<PasswordService>;
}

function buildKit(overrides: Partial<typeof userRow> = {}): Kit {
  const prisma = mockDeep<PrismaService>();
  const tokens = mockDeep<TokenService>();
  const password = mockDeep<PasswordService>();
  mockReset(prisma);
  mockReset(tokens);
  mockReset(password);

  const config = {
    get: jest.fn(
      (key: string, def?: string | number | boolean): string | number | boolean | undefined => {
        switch (key) {
          case 'MFA_SECRET_ENCRYPTION_KEY':
            return TEST_KEY_BASE64;
          case 'MFA_ISSUER':
            return 'Workpulse';
          case 'MFA_BACKUP_CODES_COUNT':
            return 8;
          case 'NODE_ENV':
            return 'test';
          default:
            return def;
        }
      },
    ),
  } as unknown as ConfigService;

  const service = new MfaService(prisma, config, tokens, password);

  // Default happy-path user; overrides mutate the object per test.
  prisma.user.findFirst.mockResolvedValue({ ...userRow, ...overrides } as never);
  prisma.$transaction.mockImplementation(((cb: (tx: PrismaService) => unknown) =>
    cb(prisma)) as never);

  return { service, prisma, tokens, password };
}

describe('MfaService', () => {
  describe('startEnrollment', () => {
    it('returns an otpauth URL + QR data URI and persists the encrypted secret', async () => {
      const { service, prisma } = buildKit();
      const result = await service.startEnrollment(userRow.id);

      expect(result.otpauthUrl).toContain('otpauth://totp/');
      expect(result.qrCodeDataUri.startsWith('data:image/png;base64,')).toBe(true);
      expect(result.secret).toMatch(/^[A-Z2-7]+$/);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: userRow.id },
          data: expect.objectContaining({
            mfaSecret: expect.any(String),
          }),
        }),
      );
    });

    it('refuses to overwrite an active MFA config', async () => {
      const { service } = buildKit({ mfaEnabledAt: new Date() });
      await expect(service.startEnrollment(userRow.id)).rejects.toThrow(BadRequestException);
    });

    it('fails if the encryption key is missing (dev env)', async () => {
      const prisma = mockDeep<PrismaService>();
      const tokens = mockDeep<TokenService>();
      const password = mockDeep<PasswordService>();
      const config = {
        get: jest.fn((key: string, def?: unknown) => {
          if (key === 'MFA_SECRET_ENCRYPTION_KEY') return undefined;
          if (key === 'NODE_ENV') return 'development';
          if (key === 'MFA_ISSUER') return 'Workpulse';
          if (key === 'MFA_BACKUP_CODES_COUNT') return 8;
          return def;
        }),
      } as unknown as ConfigService;
      const service = new MfaService(prisma, config, tokens, password);
      prisma.user.findFirst.mockResolvedValue(userRow as never);
      await expect(service.startEnrollment(userRow.id)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('confirmEnrollment', () => {
    it('activates MFA + returns backup codes + fresh access token when TOTP matches', async () => {
      const pendingSecret = 'JBSWY3DPEHPK3PXP';
      const encryptedSecret = encryptString(pendingSecret, TEST_KEY);
      const { service, prisma, tokens } = buildKit({ mfaSecret: encryptedSecret });

      // After activation the update returns the fresh row.
      prisma.user.update.mockResolvedValue({
        ...userRow,
        mfaSecret: encryptedSecret,
        mfaEnabledAt: new Date(),
      } as never);
      tokens.signStepUpAccessTokenSnapshot.mockReturnValue({
        accessToken: 'step-up.jwt',
        accessTokenExpiresIn: 900,
      });
      prisma.mfaBackupCode.deleteMany.mockResolvedValue({ count: 0 } as never);
      prisma.mfaBackupCode.createMany.mockResolvedValue({ count: 8 } as never);

      const code = authenticator.generate(pendingSecret);
      const result = await service.confirmEnrollment(userRow.id, code, {});

      expect(result.backupCodes).toHaveLength(8);
      expect(result.accessToken).toBe('step-up.jwt');
      expect(result.accessTokenExpiresIn).toBe(900);
      expect(prisma.mfaBackupCode.createMany).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'AUTH_MFA_ENABLED' }),
        }),
      );
    });

    it('rejects when enrollment has not been started', async () => {
      const { service } = buildKit({ mfaSecret: null });
      await expect(service.confirmEnrollment(userRow.id, '123456', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when TOTP code does not match', async () => {
      const pendingSecret = 'JBSWY3DPEHPK3PXP';
      const { service } = buildKit({
        mfaSecret: encryptString(pendingSecret, TEST_KEY),
      });
      await expect(service.confirmEnrollment(userRow.id, '000000', {})).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('refuses double-activation', async () => {
      const pendingSecret = 'JBSWY3DPEHPK3PXP';
      const { service } = buildKit({
        mfaSecret: encryptString(pendingSecret, TEST_KEY),
        mfaEnabledAt: new Date(),
      });
      const code = authenticator.generate(pendingSecret);
      await expect(service.confirmEnrollment(userRow.id, code, {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('verifyStepUp', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const encryptedSecret = encryptString(secret, TEST_KEY);

    function stepUpKit(): Kit {
      return buildKit({
        mfaSecret: encryptedSecret,
        mfaEnabledAt: new Date(),
      });
    }

    it('accepts a valid TOTP code + rotates refresh + issues fresh access token', async () => {
      const { service, tokens } = stepUpKit();
      const pair: IssuedTokenPair = {
        accessToken: 'new.jwt',
        accessTokenExpiresIn: 900,
        refreshToken: 'new-refresh-secret',
        refreshTokenExpiresAt: new Date(Date.now() + 86400_000),
        refreshTokenRow: { id: 'rt-new' } as never,
      };
      tokens.rotateForMfaStepUp.mockResolvedValue(pair);

      const code = authenticator.generate(secret);
      const result = await service.verifyStepUp(userRow.id, { code }, 'raw-refresh', {});

      expect(result.usedBackupCode).toBe(false);
      expect(result.accessToken).toBe('new.jwt');
      expect(result.refreshToken).toBe('new-refresh-secret');
      expect(tokens.rotateForMfaStepUp).toHaveBeenCalledWith('raw-refresh', {});
    });

    it('rejects when neither code nor backupCode is provided', async () => {
      const { service } = stepUpKit();
      await expect(service.verifyStepUp(userRow.id, {}, 'raw', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when both code and backupCode are provided', async () => {
      const { service } = stepUpKit();
      await expect(
        service.verifyStepUp(userRow.id, { code: '123456', backupCode: 'ABCD123456' }, 'raw', {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('consumes a valid backup code atomically', async () => {
      const { service, prisma, tokens } = stepUpKit();
      const code = 'ABCDEFGH12';
      const hash = hashBackupCode(code);
      prisma.mfaBackupCode.findFirst.mockResolvedValue({
        id: 'bc-1',
        userId: userRow.id,
        codeHash: hash,
        usedAt: null,
        createdAt: new Date(),
      } as never);
      prisma.mfaBackupCode.updateMany.mockResolvedValue({ count: 1 } as never);
      tokens.rotateForMfaStepUp.mockResolvedValue({
        accessToken: 'new.jwt',
        accessTokenExpiresIn: 900,
        refreshToken: 'new-rt',
        refreshTokenExpiresAt: new Date(),
        refreshTokenRow: {} as never,
      });

      const result = await service.verifyStepUp(
        userRow.id,
        { backupCode: normalizeBackupCode(code) },
        'raw',
        {},
      );
      expect(result.usedBackupCode).toBe(true);
      expect(prisma.mfaBackupCode.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'bc-1', usedAt: null },
          data: expect.objectContaining({ usedAt: expect.any(Date) }),
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'AUTH_MFA_BACKUP_USED' }),
        }),
      );
    });

    it('rejects a backup code already consumed', async () => {
      const { service, prisma } = stepUpKit();
      prisma.mfaBackupCode.findFirst.mockResolvedValue(null);
      await expect(
        service.verifyStepUp(userRow.id, { backupCode: 'ABCDEFGH12' }, 'raw', {}),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when the account has no MFA active', async () => {
      const { service } = buildKit({ mfaSecret: null, mfaEnabledAt: null });
      await expect(service.verifyStepUp(userRow.id, { code: '123456' }, 'raw', {})).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('disable', () => {
    const secret = 'JBSWY3DPEHPK3PXP';

    it('requires both password AND current TOTP', async () => {
      const { service, password } = buildKit({
        mfaSecret: encryptString(secret, TEST_KEY),
        mfaEnabledAt: new Date(),
      });
      password.verify.mockResolvedValue(false);

      const code = authenticator.generate(secret);
      await expect(service.disable(userRow.id, 'wrong-pw', code, {})).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('wipes secret + backup codes + revokes all refresh tokens on success', async () => {
      const { service, prisma, password, tokens } = buildKit({
        mfaSecret: encryptString(secret, TEST_KEY),
        mfaEnabledAt: new Date(),
      });
      password.verify.mockResolvedValue(true);
      prisma.mfaBackupCode.deleteMany.mockResolvedValue({ count: 8 } as never);
      prisma.user.update.mockResolvedValue(userRow as never);
      tokens.revokeAllForUser.mockResolvedValue();

      const code = authenticator.generate(secret);
      await service.disable(userRow.id, 'right-pw', code, {});

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ mfaSecret: null, mfaEnabledAt: null }),
        }),
      );
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith(userRow.id, 'MFA_DISABLED');
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'AUTH_MFA_DISABLED' }),
        }),
      );
    });
  });

  describe('regenerateBackupCodes', () => {
    const secret = 'JBSWY3DPEHPK3PXP';

    it('requires a valid TOTP code + replaces the whole batch', async () => {
      const { service, prisma } = buildKit({
        mfaSecret: encryptString(secret, TEST_KEY),
        mfaEnabledAt: new Date(),
      });
      prisma.mfaBackupCode.deleteMany.mockResolvedValue({ count: 8 } as never);
      prisma.mfaBackupCode.createMany.mockResolvedValue({ count: 8 } as never);

      const code = authenticator.generate(secret);
      const codes = await service.regenerateBackupCodes(userRow.id, code, {});
      expect(codes).toHaveLength(8);
      expect(prisma.mfaBackupCode.deleteMany).toHaveBeenCalledWith({
        where: { userId: userRow.id },
      });
      expect(prisma.mfaBackupCode.createMany).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'AUTH_MFA_BACKUP_REGENERATED',
          }),
        }),
      );
    });

    it('rejects when MFA is not active', async () => {
      const { service } = buildKit({ mfaSecret: null, mfaEnabledAt: null });
      await expect(service.regenerateBackupCodes(userRow.id, '123456', {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getStatus', () => {
    it('returns enabled=false + remainingBackupCodes=0 for a fresh account', async () => {
      const { service, prisma } = buildKit();
      prisma.mfaBackupCode.count.mockResolvedValue(0 as never);
      const s = await service.getStatus(userRow.id);
      expect(s.enabled).toBe(false);
      expect(s.enabledAt).toBeNull();
      expect(s.remainingBackupCodes).toBe(0);
    });

    it('surfaces the remaining backup-code count', async () => {
      const now = new Date();
      const { service, prisma } = buildKit({ mfaEnabledAt: now });
      prisma.mfaBackupCode.count.mockResolvedValue(5 as never);
      const s = await service.getStatus(userRow.id);
      expect(s.enabled).toBe(true);
      expect(s.enabledAt).toEqual(now);
      expect(s.remainingBackupCodes).toBe(5);
    });
  });
});
