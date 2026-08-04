/**
 * User credentials that mirror `apps/api/prisma/seed.ts`. Kept in sync
 * manually — if the seed changes, update these constants. Tests read from
 * this file rather than duplicating raw strings.
 */

export interface SeedUser {
  email: string;
  password: string;
  fullName: string;
  role: 'EMPLOYEE' | 'SUPERVISOR' | 'HR_MANAGER' | 'SUPER_ADMIN';
}

export const SEED_PASSWORD = 'password123';

export const SEED_USERS = {
  employee: {
    email: 'employee@acme.test',
    password: SEED_PASSWORD,
    fullName: 'Employee One',
    role: 'EMPLOYEE',
  },
  supervisor: {
    email: 'lead@acme.test',
    password: SEED_PASSWORD,
    fullName: 'Team Lead',
    role: 'SUPERVISOR',
  },
  hr: {
    email: 'hr@acme.test',
    password: SEED_PASSWORD,
    fullName: 'HR Manager',
    role: 'HR_MANAGER',
  },
  admin: {
    email: 'admin@acme.test',
    password: SEED_PASSWORD,
    fullName: 'Super Admin',
    role: 'SUPER_ADMIN',
  },
} as const satisfies Record<string, SeedUser>;

export type SeedUserKey = keyof typeof SEED_USERS;
