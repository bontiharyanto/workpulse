import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedUser } from '../types/authenticated-user';
import type { UserRole } from '../types/user-role';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = req.user;

    if (!user) {
      throw new ForbiddenException('UNAUTHORIZED');
    }

    if (!required.includes(user.role)) {
      throw new ForbiddenException('FORBIDDEN');
    }

    return true;
  }
}
