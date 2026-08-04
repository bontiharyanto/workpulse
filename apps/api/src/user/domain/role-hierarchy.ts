import type { UserRole } from '../../common/types/user-role';

/**
 * Numeric rank per role. Higher = more privilege.
 * Kept as pure data so it can be reused everywhere (guards, service, UI).
 */
export const ROLE_RANK: Readonly<Record<UserRole, number>> = Object.freeze({
  EMPLOYEE: 0,
  SUPERVISOR: 10,
  HR_MANAGER: 20,
  SUPER_ADMIN: 30,
});

/** Roles that may access the /admin surface at all. */
export const ADMIN_ROLES: ReadonlyArray<UserRole> = Object.freeze(['HR_MANAGER', 'SUPER_ADMIN']);

/**
 * Can `actor` assign `target` as a role to some user?
 *
 * Rules:
 *   - Actor must be at HR_MANAGER rank or above (baseline admin capability).
 *   - Actor cannot grant a role strictly higher than their own (no privilege escalation).
 */
export function canAssignRole(actorRole: UserRole, targetRole: UserRole): boolean {
  const actorRank = ROLE_RANK[actorRole];
  const targetRank = ROLE_RANK[targetRole];
  if (actorRank < ROLE_RANK.HR_MANAGER) return false;
  return actorRank >= targetRank;
}

/**
 * Can `actor` mutate `target`'s user record (update / deactivate / reset password)?
 *
 * Rules:
 *   - Actor must be at HR_MANAGER rank or above.
 *   - Actor cannot act on a user with a strictly higher rank than themselves.
 *   - Actor CAN act on peers at the same rank (HR_MANAGER can manage other HR_MANAGERs).
 */
export function canManageUser(actorRole: UserRole, targetRole: UserRole): boolean {
  const actorRank = ROLE_RANK[actorRole];
  const targetRank = ROLE_RANK[targetRole];
  if (actorRank < ROLE_RANK.HR_MANAGER) return false;
  return actorRank >= targetRank;
}

/** Ordered list of roles the actor is allowed to assign, low → high. */
export function assignableRoles(actorRole: UserRole): UserRole[] {
  const roles = Object.keys(ROLE_RANK) as UserRole[];
  return roles
    .filter((r) => canAssignRole(actorRole, r))
    .sort((a, b) => ROLE_RANK[a] - ROLE_RANK[b]);
}
