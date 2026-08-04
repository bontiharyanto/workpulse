import { assignableRoles, canAssignRole, canManageUser, ROLE_RANK } from './role-hierarchy';

describe('role-hierarchy', () => {
  describe('ROLE_RANK', () => {
    it('is monotonically increasing EMPLOYEE < SUPERVISOR < HR_MANAGER < SUPER_ADMIN', () => {
      expect(ROLE_RANK.EMPLOYEE).toBeLessThan(ROLE_RANK.SUPERVISOR);
      expect(ROLE_RANK.SUPERVISOR).toBeLessThan(ROLE_RANK.HR_MANAGER);
      expect(ROLE_RANK.HR_MANAGER).toBeLessThan(ROLE_RANK.SUPER_ADMIN);
    });
  });

  describe('canAssignRole', () => {
    it('rejects any assignment from EMPLOYEE or SUPERVISOR (below admin baseline)', () => {
      expect(canAssignRole('EMPLOYEE', 'EMPLOYEE')).toBe(false);
      expect(canAssignRole('SUPERVISOR', 'EMPLOYEE')).toBe(false);
    });

    it('lets HR_MANAGER assign EMPLOYEE, SUPERVISOR, HR_MANAGER — but NOT SUPER_ADMIN', () => {
      expect(canAssignRole('HR_MANAGER', 'EMPLOYEE')).toBe(true);
      expect(canAssignRole('HR_MANAGER', 'SUPERVISOR')).toBe(true);
      expect(canAssignRole('HR_MANAGER', 'HR_MANAGER')).toBe(true);
      expect(canAssignRole('HR_MANAGER', 'SUPER_ADMIN')).toBe(false);
    });

    it('lets SUPER_ADMIN assign every role', () => {
      expect(canAssignRole('SUPER_ADMIN', 'EMPLOYEE')).toBe(true);
      expect(canAssignRole('SUPER_ADMIN', 'SUPERVISOR')).toBe(true);
      expect(canAssignRole('SUPER_ADMIN', 'HR_MANAGER')).toBe(true);
      expect(canAssignRole('SUPER_ADMIN', 'SUPER_ADMIN')).toBe(true);
    });
  });

  describe('canManageUser', () => {
    it('follows the same "actor rank >= target rank AND actor >= HR" invariant', () => {
      expect(canManageUser('HR_MANAGER', 'HR_MANAGER')).toBe(true);
      expect(canManageUser('HR_MANAGER', 'SUPER_ADMIN')).toBe(false);
      expect(canManageUser('SUPERVISOR', 'EMPLOYEE')).toBe(false);
      expect(canManageUser('SUPER_ADMIN', 'HR_MANAGER')).toBe(true);
    });
  });

  describe('assignableRoles', () => {
    it('returns roles sorted low → high', () => {
      expect(assignableRoles('HR_MANAGER')).toEqual([
        'EMPLOYEE',
        'SUPERVISOR',
        'HR_MANAGER',
      ]);
      expect(assignableRoles('SUPER_ADMIN')).toEqual([
        'EMPLOYEE',
        'SUPERVISOR',
        'HR_MANAGER',
        'SUPER_ADMIN',
      ]);
    });

    it('returns empty for non-admin actors', () => {
      expect(assignableRoles('EMPLOYEE')).toEqual([]);
      expect(assignableRoles('SUPERVISOR')).toEqual([]);
    });
  });
});
