/**
 * Seed script — bootstraps a demo tenant with users, shift, geofence, and leave types.
 * Run: pnpm --filter @workpulse/api prisma:seed
 */
import { LeaveKind, PrismaClient, ShiftType, UserRole } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19 * 1024,
    timeCost: 2,
    parallelism: 1,
  });
}

async function main(): Promise<void> {
  const company = await prisma.company.upsert({
    where: { slug: 'acme-corp' },
    create: {
      name: 'Acme Corp',
      slug: 'acme-corp',
      timezone: 'Asia/Jakarta',
      // Overtime policy — configured out of the box so demo users (and E2E
      // tests) can submit OT without hitting `OVERTIME_RATE_NOT_CONFIGURED`.
      // Values chosen to match a typical Jakarta engineering rate: base
      // hourly ~ Rp 50k, with the statutory-ish 1.5×/2×/3× multipliers.
      overtimeHourlyRate: '50000',
      overtimeWeekdayMultiplier: '1.5',
      overtimeWeekendMultiplier: '2.0',
      overtimeHolidayMultiplier: '3.0',
      overtimeMaxHoursPerDay: '4.0',
      overtimeSubmitWindowDays: 14,
      overtimeCompleteGraceDays: 2,
    },
    update: {},
  });

  const department = await prisma.department.upsert({
    where: { companyId_name: { companyId: company.id, name: 'Engineering' } },
    create: { companyId: company.id, name: 'Engineering' },
    update: {},
  });

  const geofence = await prisma.geofence.create({
    data: {
      companyId: company.id,
      name: 'HQ Jakarta',
      latitude: -6.2088,
      longitude: 106.8456,
      radiusMeters: 150,
    },
  });

  const shift = await prisma.shift.upsert({
    where: { companyId_name: { companyId: company.id, name: 'Regular 9-6' } },
    create: {
      companyId: company.id,
      geofenceId: geofence.id,
      name: 'Regular 9-6',
      type: ShiftType.STATIC,
      startTime: '09:00',
      endTime: '18:00',
      graceMinutes: 15,
    },
    update: { geofenceId: geofence.id },
  });

  const passwordHash = await hashPassword('password123');

  // Super Admin — tenant-wide privileged actor used for admin endpoints
  // like the auto-absent scanner trigger. Kept intentionally separate from
  // HR Manager so E2E tests can prove RBAC boundaries (HR ≠ Super Admin).
  await prisma.user.upsert({
    where: { companyId_email: { companyId: company.id, email: 'admin@acme.test' } },
    create: {
      companyId: company.id,
      departmentId: department.id,
      email: 'admin@acme.test',
      passwordHash,
      fullName: 'Super Admin',
      role: UserRole.SUPER_ADMIN,
      hiredAt: new Date('2022-01-01'),
    },
    update: { passwordHash },
  });

  const hr = await prisma.user.upsert({
    where: { companyId_email: { companyId: company.id, email: 'hr@acme.test' } },
    create: {
      companyId: company.id,
      departmentId: department.id,
      email: 'hr@acme.test',
      passwordHash,
      fullName: 'HR Manager',
      role: UserRole.HR_MANAGER,
      hiredAt: new Date('2023-01-01'),
    },
    update: { passwordHash },
  });

  const supervisor = await prisma.user.upsert({
    where: { companyId_email: { companyId: company.id, email: 'lead@acme.test' } },
    create: {
      companyId: company.id,
      departmentId: department.id,
      email: 'lead@acme.test',
      passwordHash,
      fullName: 'Team Lead',
      role: UserRole.SUPERVISOR,
      hiredAt: new Date('2023-02-01'),
    },
    update: { passwordHash },
  });

  const employee = await prisma.user.upsert({
    where: { companyId_email: { companyId: company.id, email: 'employee@acme.test' } },
    create: {
      companyId: company.id,
      departmentId: department.id,
      email: 'employee@acme.test',
      passwordHash,
      fullName: 'Employee One',
      role: UserRole.EMPLOYEE,
      hiredAt: new Date('2024-06-01'),
      supervisorId: supervisor.id,
    },
    update: { supervisorId: supervisor.id, passwordHash },
  });

  // Shift assignments — idempotent so re-seeding doesn't blow up on the
  // (userId, shiftId, effectiveFrom) natural key. We use findFirst → create
  // rather than upsert because there is no composite unique index; two
  // seedings of the SAME row is what we want to avoid, not two seedings of
  // different (userId, shiftId) pairs.
  const employeeAssignment = await prisma.userShiftAssignment.findFirst({
    where: {
      userId: employee.id,
      shiftId: shift.id,
      effectiveFrom: new Date('2024-06-01T00:00:00Z'),
    },
    select: { id: true },
  });
  if (!employeeAssignment) {
    await prisma.userShiftAssignment.create({
      data: {
        userId: employee.id,
        shiftId: shift.id,
        effectiveFrom: new Date('2024-06-01T00:00:00Z'),
      },
    });
  }

  const annual = await prisma.leaveType.upsert({
    where: { companyId_code: { companyId: company.id, code: 'ANNUAL' } },
    create: {
      companyId: company.id,
      code: 'ANNUAL',
      name: 'Annual Leave',
      kind: LeaveKind.ANNUAL,
      defaultAnnualQuota: 12,
      carryOverMax: 5,
    },
    update: {},
  });

  const year = new Date().getUTCFullYear();
  await prisma.leaveBalance.upsert({
    where: { userId_leaveTypeId_year: { userId: employee.id, leaveTypeId: annual.id, year } },
    create: {
      userId: employee.id,
      leaveTypeId: annual.id,
      year,
      quota: 12,
      used: 0,
      reserved: 0,
      carriedOver: 0,
      remaining: 12,
    },
    update: {},
  });

  // Seed a sample holiday so calendar-aware logic (leave day counting,
  // overtime multipliers, etc.) has a real row to reason about in demos
  // and E2E tests. Idempotent via @@unique([companyId, date]).
  const nationalDay = new Date(Date.UTC(year, 7, 17)); // 17 August (Aug = month index 7)
  await prisma.holiday.upsert({
    where: { companyId_date: { companyId: company.id, date: nationalDay } },
    create: {
      companyId: company.id,
      date: nationalDay,
      name: 'Hari Kemerdekaan',
    },
    update: {},
  });

  // eslint-disable-next-line no-console
  console.warn('[seed] done', { company: company.slug, hr: hr.email, supervisor: supervisor.email, employee: employee.email });
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
