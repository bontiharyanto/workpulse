import { SetMetadata } from '@nestjs/common';

import type { UserRole } from '../types/user-role';

export const ROLES_KEY = 'workpulse:roles';

/**
 * Attach required roles to a route handler. Combined with `RolesGuard`.
 *
 * @example
 *   @Roles('HR_MANAGER', 'SUPERVISOR')
 *   @Get('team')
 *   listTeam() { ... }
 */
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
