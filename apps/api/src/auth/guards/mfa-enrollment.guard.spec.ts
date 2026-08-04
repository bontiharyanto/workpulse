import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import { MfaEnrollmentGuard } from './mfa-enrollment.guard';

function buildConfig(enforce: boolean): ConfigService {
  return {
    get: jest.fn((key: string, def?: string) =>
      key === 'MFA_ENFORCE_HR_ADMIN' ? (enforce ? 'true' : 'false') : def,
    ),
  } as unknown as ConfigService;
}

function buildContext(user: unknown): ExecutionContext {
  const handler = () => undefined;
  const cls = class {};
  const req = { user };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getHandler: () => handler as never,
    getClass: () => cls as never,
    getType: () => 'http' as never,
    getArgs: () => [] as never,
    getArgByIndex: () => undefined as never,
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
  } as unknown as ExecutionContext;
}

describe('MfaEnrollmentGuard', () => {
  const reflector = new Reflector();
  const guard = new MfaEnrollmentGuard(reflector, buildConfig(true));

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('is a no-op when MFA_ENFORCE_HR_ADMIN is false', () => {
    const disabledGuard = new MfaEnrollmentGuard(reflector, buildConfig(false));
    const ctx = buildContext({ role: 'HR_MANAGER', mfaEnabled: false });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    expect(disabledGuard.canActivate(ctx)).toBe(true);
  });

  it('lets requests through for EMPLOYEE without MFA', () => {
    const ctx = buildContext({ role: 'EMPLOYEE', mfaEnabled: false });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('lets requests through for SUPERVISOR without MFA', () => {
    const ctx = buildContext({ role: 'SUPERVISOR', mfaEnabled: false });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('blocks HR_MANAGER without MFA', () => {
    const ctx = buildContext({ role: 'HR_MANAGER', mfaEnabled: false });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    try {
      guard.canActivate(ctx);
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const payload = (err as ForbiddenException).getResponse() as Record<string, unknown>;
      expect(payload.code).toBe('MFA_ENROLLMENT_REQUIRED');
    }
  });

  it('blocks SUPER_ADMIN without MFA', () => {
    const ctx = buildContext({ role: 'SUPER_ADMIN', mfaEnabled: false });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('lets HR_MANAGER through when MFA is enabled', () => {
    const ctx = buildContext({ role: 'HR_MANAGER', mfaEnabled: true });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('lets HR_MANAGER without MFA through when @AllowMfaEnrollmentPending is set', () => {
    const ctx = buildContext({ role: 'HR_MANAGER', mfaEnabled: false });
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(false) // public
      .mockReturnValueOnce(false) // allow-must-change-password
      .mockReturnValueOnce(true); // allow-mfa-enrollment-pending
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('lets HR_MANAGER through when route is @AllowMustChangePassword', () => {
    const ctx = buildContext({ role: 'HR_MANAGER', mfaEnabled: false });
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(false) // public
      .mockReturnValueOnce(true); // allow-must-change-password
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('lets HR_MANAGER through when mfaEnabled is undefined (legacy token)', () => {
    const ctx = buildContext({ role: 'HR_MANAGER', mfaEnabled: undefined });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('is a no-op when no user is attached', () => {
    const ctx = buildContext(undefined);
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
