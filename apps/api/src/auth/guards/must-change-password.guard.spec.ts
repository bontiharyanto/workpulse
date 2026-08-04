import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ALLOW_MUST_CHANGE_PASSWORD_KEY } from '../decorators/allow-must-change-password.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

import { MustChangePasswordGuard } from './must-change-password.guard';

/**
 * Build a minimal `ExecutionContext` stub whose `switchToHttp().getRequest()`
 * returns the provided `user`. Handler + class are dummy references — the
 * reflector is programmed directly to return the desired metadata.
 */
function mkCtx(user: AuthenticatedUser | undefined): ExecutionContext {
  const req = { user };
  const handler = (): void => undefined;
  class Klass {}
  return {
    getHandler: () => handler,
    getClass: () => Klass,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getType: () => 'http',
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({} as never),
    switchToWs: () => ({} as never),
  } as unknown as ExecutionContext;
}

function baseUser(overrides?: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 'u-1',
    email: 'e@a.test',
    companyId: 'c-1',
    departmentId: null,
    role: 'EMPLOYEE',
    mustChangePassword: false,
    ...overrides,
  };
}

describe('MustChangePasswordGuard', () => {
  let reflector: Reflector;
  let guard: MustChangePasswordGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new MustChangePasswordGuard(reflector);
  });

  it('short-circuits allow when route is @Public()', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: unknown) => (key === IS_PUBLIC_KEY ? true : false));

    expect(guard.canActivate(mkCtx(baseUser({ mustChangePassword: true })))).toBe(true);
  });

  it('short-circuits allow when route is @AllowMustChangePassword()', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) =>
      key === ALLOW_MUST_CHANGE_PASSWORD_KEY ? true : false,
    );

    expect(guard.canActivate(mkCtx(baseUser({ mustChangePassword: true })))).toBe(true);
  });

  it('permits when there is no user attached (delegates to JwtAuthGuard)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

    expect(guard.canActivate(mkCtx(undefined))).toBe(true);
  });

  it('permits when the user flag is false', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

    expect(guard.canActivate(mkCtx(baseUser()))).toBe(true);
  });

  it('rejects with PASSWORD_CHANGE_REQUIRED when the flag is true', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

    try {
      guard.canActivate(mkCtx(baseUser({ mustChangePassword: true })));
      fail('expected guard to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const response = (err as ForbiddenException).getResponse();
      expect(response).toMatchObject({
        code: 'PASSWORD_CHANGE_REQUIRED',
        statusCode: 403,
      });
    }
  });

  it('honors @AllowMustChangePassword() even for temp-password callers', () => {
    // Both @Public() (false) and @AllowMustChange (true) — the allow-list
    // wins because the guard checks it explicitly before the flag.
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) =>
      key === ALLOW_MUST_CHANGE_PASSWORD_KEY ? true : false,
    );

    expect(guard.canActivate(mkCtx(baseUser({ mustChangePassword: true })))).toBe(true);
  });
});
