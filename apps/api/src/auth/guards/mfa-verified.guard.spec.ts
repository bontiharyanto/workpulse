import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { MfaVerifiedGuard } from './mfa-verified.guard';

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

describe('MfaVerifiedGuard', () => {
  const reflector = new Reflector();
  const guard = new MfaVerifiedGuard(reflector);

  it('lets requests through when the route is public', () => {
    const ctx = buildContext({});
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementationOnce(
      // Public flag
      () => true,
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('lets requests through when @AllowUnverifiedMfa is set', () => {
    const ctx = buildContext({ mfaPassed: false });
    jest.spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(false) // public
      .mockReturnValueOnce(true); // allow-unverified-mfa
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('lets requests through when @AllowMustChangePassword is set', () => {
    const ctx = buildContext({ mfaPassed: false });
    jest.spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(false) // public
      .mockReturnValueOnce(false) // allow-unverified-mfa
      .mockReturnValueOnce(true); // allow-must-change-password
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('lets requests through when the token has no mfaPassed claim (legacy)', () => {
    const ctx = buildContext({ mfaPassed: undefined });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects with MFA_REQUIRED when mfaPassed is false', () => {
    const ctx = buildContext({ mfaPassed: false });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    try {
      guard.canActivate(ctx);
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const payload = (err as ForbiddenException).getResponse() as Record<string, unknown>;
      expect(payload.code).toBe('MFA_REQUIRED');
      expect(payload.statusCode).toBe(403);
    }
  });

  it('lets requests through when mfaPassed is true', () => {
    const ctx = buildContext({ mfaPassed: true });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('passes when no user attached (delegates to JwtAuthGuard)', () => {
    const ctx = buildContext(undefined);
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    expect(guard.canActivate(ctx)).toBe(true);
  });
});

