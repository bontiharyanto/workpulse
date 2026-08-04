export const USER_ROLES = ['EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];
