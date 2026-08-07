import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SecurityPolicy } from '@prisma/client';

import { MfaEnrollmentGuard } from './mfa-enrollment.guard';
import type { SecurityPolicyService } from '../../security-policy/security-policy.service';

function buildPolicyService(enforce: boolean): SecurityPolicyService {
  return {
    getForCompany: jest.fn(async (companyId: string): Promise<SecurityPolicy> => ({
      id: 'sp-1',
      companyId,
      mfaEnforceHighPrivileged: enforce,
      // ADR-0041 fields default to "feature disabled" — this guard
      // only cares about mfaEnforceHighPrivileged, so we leave the
      // rollout-gate fields at their neutral zero values.
      locationSharingEnabled: false,
      locationSharingEnabledAt: null,
      locationSharingEnabledById: null,
      locationSharingDpiaId: null,
      locationSharingConsentCopySha: null,
      updatedAt: new Date(),
      updatedById: null,
      createdAt: new Date(),
    })),
  } as unknown as SecurityPolicyService;
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
  const guard = new MfaEnrollmentGuard(reflector, buildPolicyService(true));

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('is a no-op when the tenant policy has mfaEnforceHighPrivileged=false', async () => {
    const disabledGuard = new MfaEnrollmentGuard(reflector, buildPolicyService(false));
    const ctx = buildContext({ role: 'HR_MANAGER', mfaEnabled: false, companyId: 'c-1' });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    await expect(disabledGuard.canActivate(ctx)).resolves.toBe(true);
  });

  it('lets requests through for EMPLOYEE without MFA', async () => {
    const ctx = buildContext({ role: 'EMPLOYEE', mfaEnabled: false, companyId: 'c-1' });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('lets requests through for SUPERVISOR without MFA', async () => {
    const ctx = buildContext({ role: 'SUPERVISOR', mfaEnabled: false, companyId: 'c-1' });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('blocks HR_MANAGER without MFA when tenant enforces', async () => {
    const ctx = buildContext({ role: 'HR_MANAGER', mfaEnabled: false, companyId: 'c-1' });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    try {
      await guard.canActivate(ctx);
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const payload = (err as ForbiddenException).getResponse() as Record<string, unknown>;
      expect(payload.code).toBe('MFA_ENROLLMENT_REQUIRED');
    }
  });

  it('blocks SUPER_ADMIN without MFA when tenant enforces', async () => {
    const ctx = buildContext({ role: 'SUPER_ADMIN', mfaEnabled: false, companyId: 'c-1' });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets HR_MANAGER through when MFA is enabled', async () => {
    const ctx = buildContext({ role: 'HR_MANAGER', mfaEnabled: true, companyId: 'c-1' });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('lets HR_MANAGER without MFA through when @AllowMfaEnrollmentPending is set', async () => {
    const ctx = buildContext({ role: 'HR_MANAGER', mfaEnabled: false, companyId: 'c-1' });
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(false) // public
      .mockReturnValueOnce(false) // allow-must-change-password
      .mockReturnValueOnce(true); // allow-mfa-enrollment-pending
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('lets HR_MANAGER through when route is @AllowMustChangePassword', async () => {
    const ctx = buildContext({ role: 'HR_MANAGER', mfaEnabled: false, companyId: 'c-1' });
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(false) // public
      .mockReturnValueOnce(true); // allow-must-change-password
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('lets HR_MANAGER through when mfaEnabled is undefined (legacy token)', async () => {
    const ctx = buildContext({ role: 'HR_MANAGER', mfaEnabled: undefined, companyId: 'c-1' });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('is a no-op when no user is attached', async () => {
    const ctx = buildContext(undefined);
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
