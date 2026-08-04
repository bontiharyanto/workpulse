import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ALLOW_MUST_CHANGE_PASSWORD_KEY } from '../decorators/allow-must-change-password.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Blocks every authenticated request when the caller's JWT reports
 * `mustChangePassword=true`, except routes explicitly tagged with
 * `@AllowMustChangePassword()`.
 *
 * Registration order matters — this guard MUST run AFTER `JwtAuthGuard`
 * (which populates `req.user`) and BEFORE `RolesGuard`. See
 * `app.module.ts` `APP_GUARD` ordering.
 *
 * The error payload uses a stable `PASSWORD_CHANGE_REQUIRED` code so the
 * frontend can distinguish this state from an ordinary 403 and force-navigate
 * to `/change-password`.
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const isAllowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_MUST_CHANGE_PASSWORD_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isAllowed) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = req.user;

    // No user attached → downstream RolesGuard/JwtAuthGuard already
    // rejected. Don't shadow their error.
    if (!user) return true;

    if (user.mustChangePassword === true) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PASSWORD_CHANGE_REQUIRED',
        message:
          'Anda harus mengubah password sebelum menggunakan aplikasi. Kunjungi /change-password.',
      });
    }

    return true;
  }
}
