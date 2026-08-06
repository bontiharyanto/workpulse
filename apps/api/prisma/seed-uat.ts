/**
 * UAT / QA seed — expands the minimal `seed.ts` baseline with a realistic
 * multi-department org, extra shifts, historical attendance, and a handful
 * of pending approvals so UAT clicks around a populated dashboard.
 *
 * Idempotent: every insert is an upsert or a "check-then-create". Safe to
 * re-run — running twice produces the same DB state.
 *
 * Run:
 *   $ pnpm db:seed:uat
 *
 * NOT for production. Refuses to run when NODE_ENV=production.
 */
import {
  AttendanceCorrectionStatus,
  AttendanceStatus,
  EmploymentStatus,
  LeaveKind,
  LeaveStatus,
  NotificationType,
  OvertimeStatus,
  Prisma,
  PrismaClient,
  ShiftType,
  TimesheetEntryKind,
  TimesheetPeriodType,
  TimesheetStatus,
  UserRole,
} from '@prisma/client';
import argon2 from 'argon2';

// Reuse the production MFA encryption helper so seeded users can verify TOTP
// codes through the real `/auth/mfa/verify` endpoint (rather than a seed-only
// bypass). Keeps the seeded state one-to-one with hand-enrolled state.
import { decodeEncryptionKey, encryptString } from '../src/auth/mfa/domain/crypto';

const prisma = new PrismaClient();

const COMMON_PASSWORD = 'password123';

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

type PersonSeed = {
  email: string;
  fullName: string;
  role: UserRole;
  department: string;
  hiredAt: string; // ISO date
  supervisorEmail?: string;
  shift?: string; // shift name, default `Regular 9-6`
};

const DEPARTMENTS = [
  'Engineering',
  'Finance',
  'Marketing',
  'Operations',
  'People & Culture',
] as const;

const SHIFTS = [
  {
    name: 'Regular 9-6',
    startTime: '09:00',
    endTime: '18:00',
    graceMinutes: 15,
    breakMinutes: 60,
    geofenceName: 'HQ Jakarta',
  },
  {
    name: 'Morning 7-4',
    startTime: '07:00',
    endTime: '16:00',
    graceMinutes: 10,
    breakMinutes: 60,
    geofenceName: 'HQ Jakarta',
  },
  {
    name: 'Afternoon 12-9',
    startTime: '12:00',
    endTime: '21:00',
    graceMinutes: 15,
    breakMinutes: 60,
    geofenceName: 'HQ Jakarta',
  },
  {
    name: 'Night 22-7',
    startTime: '22:00',
    endTime: '07:00',
    graceMinutes: 15,
    breakMinutes: 45,
    geofenceName: 'Branch Bandung',
  },
] as const;

const GEOFENCES = [
  { name: 'HQ Jakarta', latitude: -6.2088, longitude: 106.8456, radiusMeters: 150 },
  { name: 'Branch Bandung', latitude: -6.9175, longitude: 107.6191, radiusMeters: 200 },
] as const;

// Extra HR + 4 supervisors (Engineering already has lead@acme.test from base seed)
const STAFF: PersonSeed[] = [
  {
    email: 'hr2@acme.test',
    fullName: 'Rina Kartika',
    role: UserRole.HR_MANAGER,
    department: 'People & Culture',
    hiredAt: '2022-05-01',
  },
  {
    email: 'budi.finance@acme.test',
    fullName: 'Budi Santoso',
    role: UserRole.SUPERVISOR,
    department: 'Finance',
    hiredAt: '2023-02-15',
  },
  {
    email: 'dewi.marketing@acme.test',
    fullName: 'Dewi Anggraini',
    role: UserRole.SUPERVISOR,
    department: 'Marketing',
    hiredAt: '2023-04-20',
  },
  {
    email: 'agus.ops@acme.test',
    fullName: 'Agus Wibowo',
    role: UserRole.SUPERVISOR,
    department: 'Operations',
    hiredAt: '2023-01-10',
  },
  {
    email: 'sinta.hr@acme.test',
    fullName: 'Sinta Wijaya',
    role: UserRole.SUPERVISOR,
    department: 'People & Culture',
    hiredAt: '2023-06-01',
  },
];

// 25 employees spread across the 5 departments.
const EMPLOYEES: PersonSeed[] = [
  // ---- Engineering (5, supervisor = lead@acme.test) ----
  {
    email: 'siti.eng@acme.test',
    fullName: 'Siti Nurhaliza',
    role: UserRole.EMPLOYEE,
    department: 'Engineering',
    hiredAt: '2024-01-08',
    supervisorEmail: 'lead@acme.test',
  },
  {
    email: 'andi.eng@acme.test',
    fullName: 'Andi Prasetyo',
    role: UserRole.EMPLOYEE,
    department: 'Engineering',
    hiredAt: '2024-02-14',
    supervisorEmail: 'lead@acme.test',
  },
  {
    email: 'tono.eng@acme.test',
    fullName: 'Tono Hermawan',
    role: UserRole.EMPLOYEE,
    department: 'Engineering',
    hiredAt: '2024-03-20',
    supervisorEmail: 'lead@acme.test',
  },
  {
    email: 'sri.eng@acme.test',
    fullName: 'Sri Rahayu',
    role: UserRole.EMPLOYEE,
    department: 'Engineering',
    hiredAt: '2025-05-02',
    supervisorEmail: 'lead@acme.test',
  },
  {
    email: 'indah.eng@acme.test',
    fullName: 'Indah Permatasari',
    role: UserRole.EMPLOYEE,
    department: 'Engineering',
    hiredAt: '2025-08-15',
    supervisorEmail: 'lead@acme.test',
  },

  // ---- Finance (5) ----
  {
    email: 'rio.fin@acme.test',
    fullName: 'Rio Setiawan',
    role: UserRole.EMPLOYEE,
    department: 'Finance',
    hiredAt: '2023-11-05',
    supervisorEmail: 'budi.finance@acme.test',
  },
  {
    email: 'maya.fin@acme.test',
    fullName: 'Maya Puspita',
    role: UserRole.EMPLOYEE,
    department: 'Finance',
    hiredAt: '2024-04-11',
    supervisorEmail: 'budi.finance@acme.test',
  },
  {
    email: 'hendra.fin@acme.test',
    fullName: 'Hendra Kusuma',
    role: UserRole.EMPLOYEE,
    department: 'Finance',
    hiredAt: '2024-07-22',
    supervisorEmail: 'budi.finance@acme.test',
  },
  {
    email: 'putri.fin@acme.test',
    fullName: 'Putri Ayu Lestari',
    role: UserRole.EMPLOYEE,
    department: 'Finance',
    hiredAt: '2025-01-16',
    supervisorEmail: 'budi.finance@acme.test',
  },
  {
    email: 'dimas.fin@acme.test',
    fullName: 'Dimas Aditya',
    role: UserRole.EMPLOYEE,
    department: 'Finance',
    hiredAt: '2025-09-01',
    supervisorEmail: 'budi.finance@acme.test',
  },

  // ---- Marketing (5) ----
  {
    email: 'lina.mkt@acme.test',
    fullName: 'Lina Marlina',
    role: UserRole.EMPLOYEE,
    department: 'Marketing',
    hiredAt: '2023-09-14',
    supervisorEmail: 'dewi.marketing@acme.test',
  },
  {
    email: 'bagus.mkt@acme.test',
    fullName: 'Bagus Pratama',
    role: UserRole.EMPLOYEE,
    department: 'Marketing',
    hiredAt: '2024-05-30',
    supervisorEmail: 'dewi.marketing@acme.test',
  },
  {
    email: 'retno.mkt@acme.test',
    fullName: 'Retno Widyawati',
    role: UserRole.EMPLOYEE,
    department: 'Marketing',
    hiredAt: '2024-08-19',
    supervisorEmail: 'dewi.marketing@acme.test',
  },
  {
    email: 'joko.mkt@acme.test',
    fullName: 'Joko Susilo',
    role: UserRole.EMPLOYEE,
    department: 'Marketing',
    hiredAt: '2025-02-24',
    supervisorEmail: 'dewi.marketing@acme.test',
  },
  {
    email: 'ayu.mkt@acme.test',
    fullName: 'Ayu Wandira',
    role: UserRole.EMPLOYEE,
    department: 'Marketing',
    hiredAt: '2025-11-07',
    supervisorEmail: 'dewi.marketing@acme.test',
  },

  // ---- Operations (6, mixed shifts to exercise scheduling) ----
  {
    email: 'reza.ops@acme.test',
    fullName: 'Reza Firmansyah',
    role: UserRole.EMPLOYEE,
    department: 'Operations',
    hiredAt: '2023-07-04',
    supervisorEmail: 'agus.ops@acme.test',
    shift: 'Morning 7-4',
  },
  {
    email: 'dian.ops@acme.test',
    fullName: 'Dian Sastro',
    role: UserRole.EMPLOYEE,
    department: 'Operations',
    hiredAt: '2024-03-12',
    supervisorEmail: 'agus.ops@acme.test',
    shift: 'Morning 7-4',
  },
  {
    email: 'arief.ops@acme.test',
    fullName: 'Arief Budiman',
    role: UserRole.EMPLOYEE,
    department: 'Operations',
    hiredAt: '2024-06-18',
    supervisorEmail: 'agus.ops@acme.test',
    shift: 'Afternoon 12-9',
  },
  {
    email: 'nur.ops@acme.test',
    fullName: 'Nur Aisyah',
    role: UserRole.EMPLOYEE,
    department: 'Operations',
    hiredAt: '2024-10-08',
    supervisorEmail: 'agus.ops@acme.test',
    shift: 'Afternoon 12-9',
  },
  {
    email: 'iqbal.ops@acme.test',
    fullName: 'Iqbal Rahman',
    role: UserRole.EMPLOYEE,
    department: 'Operations',
    hiredAt: '2025-04-03',
    supervisorEmail: 'agus.ops@acme.test',
    shift: 'Night 22-7',
  },
  {
    email: 'tia.ops@acme.test',
    fullName: 'Tia Ramadhani',
    role: UserRole.EMPLOYEE,
    department: 'Operations',
    hiredAt: '2025-06-21',
    supervisorEmail: 'agus.ops@acme.test',
    shift: 'Night 22-7',
  },

  // ---- People & Culture (2) ----
  {
    email: 'eka.hr@acme.test',
    fullName: 'Eka Puspa Sari',
    role: UserRole.EMPLOYEE,
    department: 'People & Culture',
    hiredAt: '2024-01-22',
    supervisorEmail: 'sinta.hr@acme.test',
  },
  {
    email: 'farah.hr@acme.test',
    fullName: 'Farah Diba',
    role: UserRole.EMPLOYEE,
    department: 'People & Culture',
    hiredAt: '2025-03-10',
    supervisorEmail: 'sinta.hr@acme.test',
  },
];

// ---------------------------------------------------------------------------
// Fixture data — extended UAT scenarios (Phase 2)
// ---------------------------------------------------------------------------
// These are curated end-to-end scenarios that populate the tenant with a
// realistic backlog of activity: past holidays, approved/rejected leaves,
// full overtime lifecycle (APPROVED → COMPLETED), 30-day attendance history,
// correction requests, and a handful of user edge cases (must-change
// password, on-leave, terminated). Everything is idempotent via unique
// keys or defensive `findFirst → create` patterns.

/** Public holidays for 2026 — enables overtime holiday-multiplier (3×) tests. */
const HOLIDAYS_2026: readonly { date: string; name: string }[] = [
  { date: '2026-01-01', name: 'Tahun Baru Masehi' },
  { date: '2026-03-20', name: 'Hari Suci Nyepi' },
  { date: '2026-04-03', name: 'Wafat Isa Al-Masih' },
  { date: '2026-05-01', name: 'Hari Buruh Internasional' },
  { date: '2026-05-14', name: 'Kenaikan Isa Al-Masih' },
  { date: '2026-06-01', name: 'Hari Lahir Pancasila' },
  { date: '2026-06-04', name: 'Hari Raya Waisak' },
  { date: '2026-06-27', name: 'Idul Adha 1447 H' },
  { date: '2026-08-17', name: 'Hari Kemerdekaan RI' },
  { date: '2026-09-25', name: 'Maulid Nabi Muhammad SAW' },
  { date: '2026-12-25', name: 'Hari Raya Natal' },
];

/**
 * Approved leave history — completed leaves in the recent past.
 * `startOffsetDays` is negative for past dates (matches existing daysAgoUtc convention).
 */
type LeaveHistorySeed = {
  userEmail: string;
  leaveTypeCode: 'ANNUAL' | 'SICK' | 'PERMIT';
  startOffsetDays: number;
  days: number;
  reason: string;
};

const APPROVED_LEAVE_HISTORY: readonly LeaveHistorySeed[] = [
  {
    userEmail: 'siti.eng@acme.test',
    leaveTypeCode: 'ANNUAL',
    startOffsetDays: -45,
    days: 2,
    reason: 'Wedding attendance — family',
  },
  {
    userEmail: 'andi.eng@acme.test',
    leaveTypeCode: 'ANNUAL',
    startOffsetDays: -30,
    days: 3,
    reason: 'Family trip to Yogyakarta',
  },
  {
    userEmail: 'rio.fin@acme.test',
    leaveTypeCode: 'SICK',
    startOffsetDays: -20,
    days: 2,
    reason: 'Fever + doctor visit',
  },
  {
    userEmail: 'maya.fin@acme.test',
    leaveTypeCode: 'ANNUAL',
    startOffsetDays: -60,
    days: 1,
    reason: 'Personal errand',
  },
  {
    userEmail: 'lina.mkt@acme.test',
    leaveTypeCode: 'PERMIT',
    startOffsetDays: -15,
    days: 1,
    reason: 'Child school event',
  },
  {
    userEmail: 'reza.ops@acme.test',
    leaveTypeCode: 'ANNUAL',
    startOffsetDays: -90,
    days: 4,
    reason: 'Vacation abroad',
  },
];

type RejectedLeaveSeed = LeaveHistorySeed & { decisionNote: string };
const REJECTED_LEAVE_HISTORY: readonly RejectedLeaveSeed[] = [
  {
    userEmail: 'tono.eng@acme.test',
    leaveTypeCode: 'ANNUAL',
    startOffsetDays: -10,
    days: 5,
    reason: 'Long vacation',
    decisionNote: 'Conflict with sprint delivery — please re-submit for post-release week',
  },
  {
    userEmail: 'bagus.mkt@acme.test',
    leaveTypeCode: 'PERMIT',
    startOffsetDays: -18,
    days: 2,
    reason: 'Personal matter',
    decisionNote: 'Insufficient justification for 2 consecutive days',
  },
  {
    userEmail: 'iqbal.ops@acme.test',
    leaveTypeCode: 'ANNUAL',
    startOffsetDays: -12,
    days: 3,
    reason: 'Trip planning',
    decisionNote: 'Night-shift crew shortage — try dates after Aug 20',
  },
];

/**
 * Overtime lifecycle — exercises every OvertimeStatus that isn't already
 * covered by the base `otRequests` (which are all PENDING_APPROVAL).
 */
type OtHistorySeed = {
  userEmail: string;
  workDateOffsetDays: number;
  hours: string;
  reason: string;
  finalStatus: 'APPROVED' | 'COMPLETED' | 'REJECTED';
  decisionNote?: string;
};

const OT_HISTORY: readonly OtHistorySeed[] = [
  {
    userEmail: 'siti.eng@acme.test',
    workDateOffsetDays: 5,
    hours: '2.0',
    reason: 'Sprint hotfix — API 5xx spike',
    finalStatus: 'APPROVED',
  },
  {
    userEmail: 'rio.fin@acme.test',
    workDateOffsetDays: 10,
    hours: '1.5',
    reason: 'Vendor bill audit close-out',
    finalStatus: 'APPROVED',
  },
  {
    userEmail: 'andi.eng@acme.test',
    workDateOffsetDays: 25,
    hours: '3.5',
    reason: 'Production incident — root cause + rollback',
    finalStatus: 'COMPLETED',
  },
  {
    userEmail: 'tono.eng@acme.test',
    workDateOffsetDays: 15,
    hours: '4.0',
    reason: 'Late-night deploy prep',
    finalStatus: 'REJECTED',
    decisionNote: 'No pre-approval received — please submit before working next time',
  },
];

/**
 * Users to receive an *extended* 30-workday attendance history so timesheet
 * generation and dashboard charts have enough data to be meaningful. Distinct
 * from the base `historyEmails` list which only covers ~5 workdays.
 */
const EXTENDED_ATTENDANCE_EMAILS: readonly string[] = [
  'employee@acme.test',
  'lead@acme.test',
  'hr@acme.test',
  'siti.eng@acme.test',
  'andi.eng@acme.test',
];

/** Attendance correction requests — 1 PENDING + 1 APPROVED. */
type CorrectionSeed = {
  userEmail: string;
  workDateOffsetDays: number;
  requestedClockInHhmm?: string; // WIB
  requestedClockOutHhmm?: string; // WIB
  reason: string;
  finalStatus: 'PENDING_APPROVAL' | 'APPROVED';
  decidedByEmail?: string;
};

const CORRECTIONS: readonly CorrectionSeed[] = [
  {
    userEmail: 'siti.eng@acme.test',
    workDateOffsetDays: 3,
    requestedClockInHhmm: '09:15',
    reason: 'Forgot to punch in — was in interview panel meeting',
    finalStatus: 'PENDING_APPROVAL',
  },
  {
    userEmail: 'andi.eng@acme.test',
    workDateOffsetDays: 8,
    requestedClockOutHhmm: '18:30',
    reason: 'WiFi outage at building exit — could not clock out',
    finalStatus: 'APPROVED',
    decidedByEmail: 'lead@acme.test',
  },
];

/**
 * Edge-case users. Kept separate from `EMPLOYEES` so they don't get the
 * default ACTIVE + Regular 9-6 treatment applied to the mainline crew.
 */
type EdgeUser = {
  email: string;
  fullName: string;
  role: UserRole;
  department: string;
  hiredAt: string;
  supervisorEmail: string;
  /** Force a password change on first login (post-onboarding UX flow). */
  mustChangePassword?: boolean;
  /** Non-ACTIVE employment state. TERMINATED implies deletedAt is also set below. */
  employmentStatus?: EmploymentStatus;
  /** ISO date; setting this soft-deletes the user (won't appear in default queries). */
  deletedAt?: string;
};

const EDGE_USERS: readonly EdgeUser[] = [
  {
    email: 'newbie.eng@acme.test',
    fullName: 'Newbie Onboarding',
    role: UserRole.EMPLOYEE,
    department: 'Engineering',
    hiredAt: '2026-08-01',
    supervisorEmail: 'lead@acme.test',
    mustChangePassword: true,
  },
  {
    email: 'mira.eng@acme.test',
    fullName: 'Mira Mahatma',
    role: UserRole.EMPLOYEE,
    department: 'Engineering',
    hiredAt: '2023-05-10',
    supervisorEmail: 'lead@acme.test',
    employmentStatus: EmploymentStatus.ON_LEAVE, // maternity — still on payroll
  },
  {
    email: 'exit.mkt@acme.test',
    fullName: 'Exit Employee',
    role: UserRole.EMPLOYEE,
    department: 'Marketing',
    hiredAt: '2022-07-15',
    supervisorEmail: 'dewi.marketing@acme.test',
    employmentStatus: EmploymentStatus.TERMINATED,
    // Soft-deleted — won't show up in HR /admin/karyawan by default, but the
    // row is preserved so audit trails linking to it stay intact.
    deletedAt: '2025-12-31',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19 * 1024,
    timeCost: 2,
    parallelism: 1,
  });
}

/**
 * Deterministic date shifted N days ago in UTC (time zeroed to 00:00).
 * Using UTC avoids DST off-by-ones during UAT sessions.
 */
function daysAgoUtc(offsetDays: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offsetDays);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Build a `Date` at HH:mm on the given UTC calendar day (interpreted as WIB → UTC-7). */
function timeOnDate(day: Date, hh: number, mm: number): Date {
  // WIB is UTC+7 — a 09:00 WIB clock-in is 02:00 UTC on the same calendar day.
  const wibOffsetHours = -7;
  const d = new Date(day);
  d.setUTCHours(hh + wibOffsetHours, mm, 0, 0);
  return d;
}

/** Only Mon-Fri days from today back to offsetDays; today excluded. */
function weekdayOffsets(daysBack: number): number[] {
  const offsets: number[] = [];
  for (let i = 1; i <= daysBack; i++) {
    const d = daysAgoUtc(i);
    const weekday = d.getUTCDay(); // 0=Sun, 6=Sat
    if (weekday !== 0 && weekday !== 6) offsets.push(i);
  }
  return offsets;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-uat.ts refuses to run with NODE_ENV=production');
  }

  const passwordHash = await hashPassword(COMMON_PASSWORD);

  // -------------------------------------------------------------------------
  // 1. Company
  // -------------------------------------------------------------------------
  const company = await prisma.company.upsert({
    where: { slug: 'acme-corp' },
    create: {
      name: 'Acme Corp',
      slug: 'acme-corp',
      timezone: 'Asia/Jakarta',
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

  // -------------------------------------------------------------------------
  // 2. Departments — all five, idempotent by (companyId, name)
  // -------------------------------------------------------------------------
  const deptByName = new Map<string, string>();
  for (const name of DEPARTMENTS) {
    const dept = await prisma.department.upsert({
      where: { companyId_name: { companyId: company.id, name } },
      create: { companyId: company.id, name },
      update: {},
    });
    deptByName.set(name, dept.id);
  }

  // -------------------------------------------------------------------------
  // 3. Geofences — Jakarta HQ + Bandung branch
  // -------------------------------------------------------------------------
  const geofenceByName = new Map<string, string>();
  for (const g of GEOFENCES) {
    // No unique constraint on (companyId, name), so findFirst-then-create.
    const existing = await prisma.geofence.findFirst({
      where: { companyId: company.id, name: g.name, deletedAt: null },
    });
    if (existing) {
      geofenceByName.set(g.name, existing.id);
    } else {
      const created = await prisma.geofence.create({
        data: {
          companyId: company.id,
          name: g.name,
          latitude: g.latitude,
          longitude: g.longitude,
          radiusMeters: g.radiusMeters,
        },
      });
      geofenceByName.set(g.name, created.id);
    }
  }

  // -------------------------------------------------------------------------
  // 4. Shifts — idempotent by (companyId, name)
  // -------------------------------------------------------------------------
  const shiftByName = new Map<string, string>();
  for (const s of SHIFTS) {
    const geofenceId = geofenceByName.get(s.geofenceName);
    // Do NOT overwrite `geofenceId` on update: HR may have manually
    // re-linked a shift to a different geofence via the admin UI (e.g.
    // moving "Regular 9-6" from the default "HQ Jakarta" to their real
    // office "HQ LA TBS"). Re-seeding would silently revert that.
    const shift = await prisma.shift.upsert({
      where: { companyId_name: { companyId: company.id, name: s.name } },
      create: {
        companyId: company.id,
        geofenceId,
        name: s.name,
        type: ShiftType.STATIC,
        startTime: s.startTime,
        endTime: s.endTime,
        graceMinutes: s.graceMinutes,
        breakMinutes: s.breakMinutes,
      },
      update: { breakMinutes: s.breakMinutes },
    });
    shiftByName.set(s.name, shift.id);
  }

  // -------------------------------------------------------------------------
  // 5. Leave types — ANNUAL (existing) + SICK + PERMIT
  // -------------------------------------------------------------------------
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
  const sick = await prisma.leaveType.upsert({
    where: { companyId_code: { companyId: company.id, code: 'SICK' } },
    create: {
      companyId: company.id,
      code: 'SICK',
      name: 'Sick Leave',
      kind: LeaveKind.SICK,
      defaultAnnualQuota: 12,
      carryOverMax: 0,
      requiresAttachment: true,
    },
    update: {},
  });
  const permit = await prisma.leaveType.upsert({
    where: { companyId_code: { companyId: company.id, code: 'PERMIT' } },
    create: {
      companyId: company.id,
      code: 'PERMIT',
      name: 'Personal Permit',
      kind: LeaveKind.PERSONAL,
      defaultAnnualQuota: 5,
      carryOverMax: 0,
    },
    update: {},
  });
  const leaveTypes = [annual, sick, permit] as const;

  // -------------------------------------------------------------------------
  // 6. Users — supervisors first, then employees so `supervisorId` resolves.
  //    Base users (admin/hr/lead/employee@acme.test) come from `seed.ts`; if
  //    they aren't seeded yet, this script still works because employees
  //    only depend on supervisors defined in `STAFF` or on `lead@acme.test`,
  //    which we upsert defensively below.
  // -------------------------------------------------------------------------

  // Defensive upsert for the Engineering supervisor (`lead@acme.test`) so
  // this script is safe to run against a virgin database, too.
  await prisma.user.upsert({
    where: { companyId_email: { companyId: company.id, email: 'lead@acme.test' } },
    create: {
      companyId: company.id,
      departmentId: deptByName.get('Engineering')!,
      email: 'lead@acme.test',
      passwordHash,
      fullName: 'Team Lead',
      role: UserRole.SUPERVISOR,
      hiredAt: new Date('2023-02-01'),
    },
    update: {},
  });

  const userByEmail = new Map<string, { id: string; role: UserRole }>();

  for (const person of STAFF) {
    const user = await prisma.user.upsert({
      where: { companyId_email: { companyId: company.id, email: person.email } },
      create: {
        companyId: company.id,
        departmentId: deptByName.get(person.department)!,
        email: person.email,
        passwordHash,
        fullName: person.fullName,
        role: person.role,
        employmentStatus: EmploymentStatus.ACTIVE,
        hiredAt: new Date(person.hiredAt),
      },
      update: { passwordHash },
      select: { id: true, role: true },
    });
    userByEmail.set(person.email, user);
  }

  // Look up lead@acme.test id so Engineering employees can reference it.
  const lead = await prisma.user.findFirst({
    where: { companyId: company.id, email: 'lead@acme.test' },
    select: { id: true },
  });
  if (lead) userByEmail.set('lead@acme.test', { id: lead.id, role: UserRole.SUPERVISOR });

  for (const person of EMPLOYEES) {
    const supervisor = person.supervisorEmail ? userByEmail.get(person.supervisorEmail) : undefined;
    const user = await prisma.user.upsert({
      where: { companyId_email: { companyId: company.id, email: person.email } },
      create: {
        companyId: company.id,
        departmentId: deptByName.get(person.department)!,
        email: person.email,
        passwordHash,
        fullName: person.fullName,
        role: person.role,
        employmentStatus: EmploymentStatus.ACTIVE,
        hiredAt: new Date(person.hiredAt),
        supervisorId: supervisor?.id,
      },
      update: {
        passwordHash,
        supervisorId: supervisor?.id,
        departmentId: deptByName.get(person.department)!,
      },
      select: { id: true, role: true },
    });
    userByEmail.set(person.email, user);
  }

  // -------------------------------------------------------------------------
  // 7. Shift assignments — one per user, effective from hiredAt
  // -------------------------------------------------------------------------
  const allPersons = [...STAFF, ...EMPLOYEES];
  for (const person of allPersons) {
    const user = userByEmail.get(person.email);
    if (!user) continue;
    const shiftId = shiftByName.get(person.shift ?? 'Regular 9-6')!;
    const effectiveFrom = new Date(person.hiredAt);
    const existing = await prisma.userShiftAssignment.findFirst({
      where: { userId: user.id, shiftId, effectiveFrom },
      select: { id: true },
    });
    if (!existing) {
      await prisma.userShiftAssignment.create({
        data: { userId: user.id, shiftId, effectiveFrom },
      });
    }
  }

  // -------------------------------------------------------------------------
  // 8. Leave balances — every non-admin user gets a row for each leave type
  //    for the current UTC year. Idempotent via composite unique key.
  // -------------------------------------------------------------------------
  const year = new Date().getUTCFullYear();
  for (const person of allPersons) {
    const user = userByEmail.get(person.email);
    if (!user) continue;
    for (const lt of leaveTypes) {
      await prisma.leaveBalance.upsert({
        where: {
          userId_leaveTypeId_year: {
            userId: user.id,
            leaveTypeId: lt.id,
            year,
          },
        },
        create: {
          userId: user.id,
          leaveTypeId: lt.id,
          year,
          quota: lt.defaultAnnualQuota,
          used: 0,
          reserved: 0,
          carriedOver: 0,
          remaining: lt.defaultAnnualQuota,
        },
        update: {},
      });
    }
  }

  // -------------------------------------------------------------------------
  // 9. Historical attendance — last 5 working days for a subset of employees.
  //    Deterministic pattern per email so re-runs produce identical rows;
  //    covers ON_TIME / LATE / EARLY_LEAVE so dashboards have variety.
  // -------------------------------------------------------------------------
  const historyEmails = [
    'employee@acme.test',
    'siti.eng@acme.test',
    'andi.eng@acme.test',
    'tono.eng@acme.test',
    'rio.fin@acme.test',
    'maya.fin@acme.test',
    'lina.mkt@acme.test',
    'bagus.mkt@acme.test',
    'reza.ops@acme.test',
    'dian.ops@acme.test',
  ];
  const workdayOffsets = weekdayOffsets(9); // last ~5 weekdays

  // 60-minute break, so a 09:00-18:00 shift bills 8h regular. The
  // AttendanceRecord itself only carries clock times + late/early minutes.
  for (const email of historyEmails) {
    const user = userByEmail.get(email);
    if (!user) continue;
    const person = allPersons.find((p) => p.email === email) ?? { shift: 'Regular 9-6' as const };
    const shiftName = person.shift ?? 'Regular 9-6';
    const shiftDef = SHIFTS.find((s) => s.name === shiftName)!;
    const shiftId = shiftByName.get(shiftName)!;
    const [shiftStartH, shiftStartM] = shiftDef.startTime.split(':').map(Number) as [
      number,
      number,
    ];
    const [shiftEndH, shiftEndM] = shiftDef.endTime.split(':').map(Number) as [number, number];
    // Cheap deterministic hash: sum of char codes mod pattern length.
    const seed = email.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

    for (let idx = 0; idx < workdayOffsets.length; idx++) {
      const offset = workdayOffsets[idx]!;
      const workDate = daysAgoUtc(offset);

      // Pattern: 70% on-time, 20% late, 10% early leave.
      const bucket = (seed + idx) % 10;
      let status: AttendanceStatus = AttendanceStatus.ON_TIME;
      let lateMinutes = 0;
      let earlyLeaveMinutes = 0;
      let clockInMinutes = shiftStartM;
      let clockOutMinutes = shiftEndM;
      if (bucket < 2) {
        status = AttendanceStatus.LATE;
        lateMinutes = 25 + ((seed + idx) % 15); // 25–39 minutes late
        clockInMinutes = shiftStartM + lateMinutes;
      } else if (bucket === 2) {
        status = AttendanceStatus.EARLY_LEAVE;
        earlyLeaveMinutes = 30 + ((seed + idx) % 10);
        clockOutMinutes = shiftEndM - earlyLeaveMinutes;
      }

      const clockInAt = timeOnDate(workDate, shiftStartH, clockInMinutes);
      const clockOutAt = timeOnDate(workDate, shiftEndH, clockOutMinutes);
      // Night shift 22-7: end is on the NEXT calendar day.
      if (shiftEndH < shiftStartH) clockOutAt.setUTCDate(clockOutAt.getUTCDate() + 1);

      const existing = await prisma.attendanceRecord.findFirst({
        where: { userId: user.id, workDate },
        select: { id: true },
      });
      if (existing) continue;

      await prisma.attendanceRecord.create({
        data: {
          companyId: company.id,
          userId: user.id,
          shiftId,
          workDate,
          clockInAt,
          clockOutAt,
          clockInLatitude: -6.2088,
          clockInLongitude: 106.8456,
          clockInAccuracyM: 10,
          clockOutLatitude: -6.2088,
          clockOutLongitude: 106.8456,
          clockOutAccuracyM: 12,
          status,
          lateMinutes,
          earlyLeaveMinutes,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // 10. Pending leave requests — populate the approval inbox.
  //     3 at PENDING_SUPERVISOR (waiting supervisor), 2 at PENDING_HR.
  // -------------------------------------------------------------------------
  type LeaveSeed = {
    userEmail: string;
    leaveTypeId: string;
    startOffsetDays: number;
    days: number;
    reason: string;
    stage: 'PENDING_SUPERVISOR' | 'PENDING_HR';
  };
  const leaveRequests: LeaveSeed[] = [
    {
      userEmail: 'siti.eng@acme.test',
      leaveTypeId: annual.id,
      startOffsetDays: 7,
      days: 3,
      reason: 'Family gathering out of town',
      stage: 'PENDING_SUPERVISOR',
    },
    {
      userEmail: 'rio.fin@acme.test',
      leaveTypeId: annual.id,
      startOffsetDays: 14,
      days: 2,
      reason: 'Personal appointment',
      stage: 'PENDING_SUPERVISOR',
    },
    {
      userEmail: 'lina.mkt@acme.test',
      leaveTypeId: sick.id,
      startOffsetDays: -1,
      days: 1,
      reason: 'Flu, doctor advised rest',
      stage: 'PENDING_SUPERVISOR',
    },
    {
      userEmail: 'reza.ops@acme.test',
      leaveTypeId: annual.id,
      startOffsetDays: 21,
      days: 5,
      reason: 'Annual vacation',
      stage: 'PENDING_HR',
    },
    {
      userEmail: 'eka.hr@acme.test',
      leaveTypeId: permit.id,
      startOffsetDays: 3,
      days: 1,
      reason: 'School meeting for child',
      stage: 'PENDING_HR',
    },
  ];

  for (const req of leaveRequests) {
    const user = userByEmail.get(req.userEmail);
    if (!user) continue;
    // Skip if this user already has a pending request for the same window — keeps re-runs idempotent.
    const dupe = await prisma.leaveRequest.findFirst({
      where: {
        userId: user.id,
        leaveTypeId: req.leaveTypeId,
        status: { in: [LeaveStatus.PENDING_SUPERVISOR, LeaveStatus.PENDING_HR] },
      },
      select: { id: true },
    });
    if (dupe) continue;

    const supervisor = await prisma.user.findUnique({
      where: { id: user.id },
      select: { supervisorId: true },
    });

    const startDate = daysAgoUtc(-req.startOffsetDays);
    const endDate = daysAgoUtc(-(req.startOffsetDays + req.days - 1));

    await prisma.$transaction(async (tx) => {
      await tx.leaveBalance.update({
        where: {
          userId_leaveTypeId_year: {
            userId: user.id,
            leaveTypeId: req.leaveTypeId,
            year,
          },
        },
        data: {
          reserved: { increment: req.days },
          remaining: { decrement: req.days },
          version: { increment: 1 },
        },
      });

      await tx.leaveRequest.create({
        data: {
          companyId: company.id,
          userId: user.id,
          leaveTypeId: req.leaveTypeId,
          status:
            req.stage === 'PENDING_HR' ? LeaveStatus.PENDING_HR : LeaveStatus.PENDING_SUPERVISOR,
          startDate,
          endDate,
          days: req.days,
          reason: req.reason,
          // For PENDING_HR we simulate that the supervisor already approved.
          supervisorId: req.stage === 'PENDING_HR' ? (supervisor?.supervisorId ?? null) : null,
          supervisorAt: req.stage === 'PENDING_HR' ? new Date() : null,
          supervisorNote: req.stage === 'PENDING_HR' ? 'Approved by supervisor (UAT seed)' : null,
        },
      });
    });
  }

  // -------------------------------------------------------------------------
  // 11. Pending overtime requests — 2 rows in the HR/supervisor inbox.
  // -------------------------------------------------------------------------
  type OtSeed = {
    userEmail: string;
    workDateOffsetDays: number;
    hours: string;
    reason: string;
  };
  const otRequests: OtSeed[] = [
    {
      userEmail: 'andi.eng@acme.test',
      workDateOffsetDays: 2,
      hours: '2.5',
      reason: 'Release cutover support',
    },
    {
      userEmail: 'maya.fin@acme.test',
      workDateOffsetDays: 3,
      hours: '3.0',
      reason: 'Month-end reconciliation',
    },
    {
      userEmail: 'dian.ops@acme.test',
      workDateOffsetDays: 1,
      hours: '1.5',
      reason: 'Warehouse stocktake',
    },
  ];

  for (const ot of otRequests) {
    const user = userByEmail.get(ot.userEmail);
    if (!user) continue;
    const workDate = daysAgoUtc(ot.workDateOffsetDays);
    // Idempotency: skip if any active OT already exists for this (user, date).
    const dupe = await prisma.overtimeRequest.findFirst({
      where: {
        userId: user.id,
        workDate,
        status: {
          in: [OvertimeStatus.PENDING_APPROVAL, OvertimeStatus.APPROVED, OvertimeStatus.COMPLETED],
        },
      },
      select: { id: true },
    });
    if (dupe) continue;

    const baseRate = 50000; // company default
    const isWeekend = [0, 6].includes(workDate.getUTCDay());
    const multiplier = isWeekend ? 2 : 1.5;
    const ratePerHour = baseRate * multiplier;
    const totalAmount = ratePerHour * Number(ot.hours);

    await prisma.overtimeRequest.create({
      data: {
        companyId: company.id,
        userId: user.id,
        workDate,
        hours: ot.hours,
        reason: ot.reason,
        status: OvertimeStatus.PENDING_APPROVAL,
        baseRate: baseRate.toString(),
        rateMultiplier: multiplier.toString(),
        ratePerHour: ratePerHour.toString(),
        totalAmount: totalAmount.toString(),
      },
    });
  }

  // -------------------------------------------------------------------------
  // 12. Public holidays 2026 — enables holiday-multiplier (3×) overtime tests
  //     and calendar-aware leave day counting. Idempotent via @@unique
  //     ([companyId, date]).
  // -------------------------------------------------------------------------
  for (const h of HOLIDAYS_2026) {
    const holidayDate = new Date(`${h.date}T00:00:00Z`);
    await prisma.holiday.upsert({
      where: { companyId_date: { companyId: company.id, date: holidayDate } },
      create: { companyId: company.id, date: holidayDate, name: h.name },
      update: { name: h.name },
    });
  }

  // -------------------------------------------------------------------------
  // 13. Leave history — APPROVED completed leaves (past dates).
  //     Balance invariant: `used += days`, `remaining -= days`. We do NOT
  //     touch `reserved` because these rows never sat in the pending pool.
  //     Idempotency: skip if a matching (user, leaveType, startDate) already
  //     exists in APPROVED / REJECTED state.
  // -------------------------------------------------------------------------
  const leaveTypeByCode = new Map<'ANNUAL' | 'SICK' | 'PERMIT', string>([
    ['ANNUAL', annual.id],
    ['SICK', sick.id],
    ['PERMIT', permit.id],
  ]);

  for (const req of APPROVED_LEAVE_HISTORY) {
    const user = userByEmail.get(req.userEmail);
    if (!user) continue;
    const leaveTypeId = leaveTypeByCode.get(req.leaveTypeCode);
    if (!leaveTypeId) continue;

    const startDate = daysAgoUtc(-req.startOffsetDays);
    const endDate = daysAgoUtc(-(req.startOffsetDays + req.days - 1));

    const dupe = await prisma.leaveRequest.findFirst({
      where: {
        userId: user.id,
        leaveTypeId,
        startDate,
        status: { in: [LeaveStatus.APPROVED, LeaveStatus.REJECTED] },
      },
      select: { id: true },
    });
    if (dupe) continue;

    // Look up supervisor + a plausible HR approver (for ANNUAL: 2-level flow).
    const userRow = await prisma.user.findUnique({
      where: { id: user.id },
      select: { supervisorId: true, companyId: true },
    });
    const hrRow = await prisma.user.findFirst({
      where: { companyId: userRow?.companyId ?? company.id, role: UserRole.HR_MANAGER },
      select: { id: true },
    });
    const supervisorAt = new Date(startDate);
    supervisorAt.setUTCDate(supervisorAt.getUTCDate() - 5);
    const hrManagerAt = new Date(supervisorAt);
    hrManagerAt.setUTCDate(hrManagerAt.getUTCDate() + 1);

    await prisma.$transaction(async (tx) => {
      await tx.leaveBalance.update({
        where: {
          userId_leaveTypeId_year: { userId: user.id, leaveTypeId, year },
        },
        data: {
          used: { increment: req.days },
          remaining: { decrement: req.days },
          version: { increment: 1 },
        },
      });

      await tx.leaveRequest.create({
        data: {
          companyId: company.id,
          userId: user.id,
          leaveTypeId,
          status: LeaveStatus.APPROVED,
          startDate,
          endDate,
          days: req.days,
          reason: req.reason,
          supervisorId: userRow?.supervisorId ?? null,
          supervisorAt,
          supervisorNote: 'Approved (UAT seed history)',
          hrManagerId: hrRow?.id ?? null,
          hrManagerAt,
          hrManagerNote: 'Confirmed (UAT seed history)',
        },
      });
    });
  }

  // -------------------------------------------------------------------------
  // 14. Leave history — REJECTED at supervisor level. No balance mutation
  //     needed because these rows never entered the reserved pool in seed.
  // -------------------------------------------------------------------------
  for (const req of REJECTED_LEAVE_HISTORY) {
    const user = userByEmail.get(req.userEmail);
    if (!user) continue;
    const leaveTypeId = leaveTypeByCode.get(req.leaveTypeCode);
    if (!leaveTypeId) continue;

    const startDate = daysAgoUtc(-req.startOffsetDays);
    const endDate = daysAgoUtc(-(req.startOffsetDays + req.days - 1));

    const dupe = await prisma.leaveRequest.findFirst({
      where: {
        userId: user.id,
        leaveTypeId,
        startDate,
        status: LeaveStatus.REJECTED,
      },
      select: { id: true },
    });
    if (dupe) continue;

    const userRow = await prisma.user.findUnique({
      where: { id: user.id },
      select: { supervisorId: true },
    });
    const decisionAt = new Date(startDate);
    decisionAt.setUTCDate(decisionAt.getUTCDate() - 3);

    await prisma.leaveRequest.create({
      data: {
        companyId: company.id,
        userId: user.id,
        leaveTypeId,
        status: LeaveStatus.REJECTED,
        startDate,
        endDate,
        days: req.days,
        reason: req.reason,
        supervisorId: userRow?.supervisorId ?? null,
        supervisorAt: decisionAt,
        supervisorNote: req.decisionNote,
      },
    });
  }

  // -------------------------------------------------------------------------
  // 15. Overtime lifecycle — APPROVED, COMPLETED, REJECTED. Multiplier is
  //     computed from the workDate's weekday to keep rate math consistent
  //     with what production would produce.
  // -------------------------------------------------------------------------
  const baseRate = 50000; // company default
  for (const ot of OT_HISTORY) {
    const user = userByEmail.get(ot.userEmail);
    if (!user) continue;
    const workDate = daysAgoUtc(ot.workDateOffsetDays);

    const dupe = await prisma.overtimeRequest.findFirst({
      where: {
        userId: user.id,
        workDate,
        // We tolerate PENDING here — a fresh seed will produce PENDING via
        // section 11, and we don't want section 15 to also create an
        // APPROVED for the same (user, date). The status filter also stops
        // us from re-inserting a COMPLETED on re-run.
        status: {
          in: [
            OvertimeStatus.PENDING_APPROVAL,
            OvertimeStatus.APPROVED,
            OvertimeStatus.COMPLETED,
            OvertimeStatus.REJECTED,
          ],
        },
      },
      select: { id: true },
    });
    if (dupe) continue;

    const isWeekend = [0, 6].includes(workDate.getUTCDay());
    const multiplier = isWeekend ? 2 : 1.5;
    const ratePerHour = baseRate * multiplier;
    const totalAmount = ratePerHour * Number(ot.hours);

    // Approver: use user's supervisor (for eng users this is `lead@acme.test`).
    const userRow = await prisma.user.findUnique({
      where: { id: user.id },
      select: { supervisorId: true },
    });
    const decisionAt = new Date(workDate);
    decisionAt.setUTCDate(decisionAt.getUTCDate() + 1);

    const targetStatus =
      ot.finalStatus === 'APPROVED'
        ? OvertimeStatus.APPROVED
        : ot.finalStatus === 'COMPLETED'
          ? OvertimeStatus.COMPLETED
          : OvertimeStatus.REJECTED;

    await prisma.overtimeRequest.create({
      data: {
        companyId: company.id,
        userId: user.id,
        workDate,
        hours: ot.hours,
        reason: ot.reason,
        status: targetStatus,
        baseRate: baseRate.toString(),
        rateMultiplier: multiplier.toString(),
        ratePerHour: ratePerHour.toString(),
        totalAmount: totalAmount.toString(),
        approvedById: userRow?.supervisorId ?? null,
        approvedAt: targetStatus !== OvertimeStatus.REJECTED ? decisionAt : null,
        rejectedAt: targetStatus === OvertimeStatus.REJECTED ? decisionAt : null,
        completedAt:
          targetStatus === OvertimeStatus.COMPLETED
            ? new Date(decisionAt.getTime() + 3 * 24 * 60 * 60 * 1000) // 3 days after approval
            : null,
        decisionNote: ot.decisionNote ?? null,
      },
    });
  }

  // -------------------------------------------------------------------------
  // 16. Extended 30-workday attendance history for 5 key users. Same
  //     deterministic 70/20/10 (on-time/late/early-leave) distribution as
  //     section 9, but with a wider window so timesheet generation and
  //     the HR trend chart have meaningful data. Idempotent per (user, workDate).
  // -------------------------------------------------------------------------
  const extendedOffsets = weekdayOffsets(45); // ~30 weekdays
  for (const email of EXTENDED_ATTENDANCE_EMAILS) {
    const user = userByEmail.get(email);
    if (!user) continue;
    const person = allPersons.find((p) => p.email === email);
    const shiftName = person?.shift ?? 'Regular 9-6';
    const shiftDef = SHIFTS.find((s) => s.name === shiftName)!;
    const shiftId = shiftByName.get(shiftName)!;
    const [shiftStartH, shiftStartM] = shiftDef.startTime.split(':').map(Number) as [
      number,
      number,
    ];
    const [shiftEndH, shiftEndM] = shiftDef.endTime.split(':').map(Number) as [number, number];
    const seed = email.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

    for (let idx = 0; idx < extendedOffsets.length; idx++) {
      const offset = extendedOffsets[idx]!;
      const workDate = daysAgoUtc(offset);

      const bucket = (seed + idx) % 10;
      let status: AttendanceStatus = AttendanceStatus.ON_TIME;
      let lateMinutes = 0;
      let earlyLeaveMinutes = 0;
      let clockInMinutes = shiftStartM;
      let clockOutMinutes = shiftEndM;
      if (bucket < 2) {
        status = AttendanceStatus.LATE;
        lateMinutes = 25 + ((seed + idx) % 15);
        clockInMinutes = shiftStartM + lateMinutes;
      } else if (bucket === 2) {
        status = AttendanceStatus.EARLY_LEAVE;
        earlyLeaveMinutes = 30 + ((seed + idx) % 10);
        clockOutMinutes = shiftEndM - earlyLeaveMinutes;
      }

      const clockInAt = timeOnDate(workDate, shiftStartH, clockInMinutes);
      const clockOutAt = timeOnDate(workDate, shiftEndH, clockOutMinutes);
      if (shiftEndH < shiftStartH) clockOutAt.setUTCDate(clockOutAt.getUTCDate() + 1);

      const existing = await prisma.attendanceRecord.findFirst({
        where: { userId: user.id, workDate },
        select: { id: true },
      });
      if (existing) continue;

      await prisma.attendanceRecord.create({
        data: {
          companyId: company.id,
          userId: user.id,
          shiftId,
          workDate,
          clockInAt,
          clockOutAt,
          clockInLatitude: -6.2088,
          clockInLongitude: 106.8456,
          clockInAccuracyM: 10,
          clockOutLatitude: -6.2088,
          clockOutLongitude: 106.8456,
          clockOutAccuracyM: 12,
          status,
          lateMinutes,
          earlyLeaveMinutes,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // 17. Attendance corrections — 1 PENDING + 1 APPROVED. The APPROVED row
  //     assumes the target AttendanceRecord already exists (from section 16
  //     extended history), so we only insert the correction row itself —
  //     re-applying it to the attendance row is out of scope for the seed
  //     (that's the service layer's job).
  // -------------------------------------------------------------------------
  for (const c of CORRECTIONS) {
    const user = userByEmail.get(c.userEmail);
    if (!user) continue;
    const workDate = daysAgoUtc(c.workDateOffsetDays);

    const dupe = await prisma.attendanceCorrection.findFirst({
      where: { userId: user.id, workDate, deletedAt: null },
      select: { id: true },
    });
    if (dupe) continue;

    const userRow = await prisma.user.findUnique({
      where: { id: user.id },
      select: { supervisorId: true },
    });

    const requestedClockInAt = c.requestedClockInHhmm
      ? (() => {
          const [hh, mm] = c.requestedClockInHhmm.split(':').map(Number) as [number, number];
          return timeOnDate(workDate, hh, mm);
        })()
      : null;
    const requestedClockOutAt = c.requestedClockOutHhmm
      ? (() => {
          const [hh, mm] = c.requestedClockOutHhmm.split(':').map(Number) as [number, number];
          return timeOnDate(workDate, hh, mm);
        })()
      : null;

    const decidedById = c.decidedByEmail
      ? (userByEmail.get(c.decidedByEmail)?.id ?? null)
      : null;
    const decidedAt =
      c.finalStatus === 'APPROVED'
        ? (() => {
            const d = new Date(workDate);
            d.setUTCDate(d.getUTCDate() + 1);
            return d;
          })()
        : null;

    await prisma.attendanceCorrection.create({
      data: {
        companyId: company.id,
        userId: user.id,
        workDate,
        requestedClockInAt,
        requestedClockOutAt,
        reason: c.reason,
        status:
          c.finalStatus === 'APPROVED'
            ? AttendanceCorrectionStatus.APPROVED
            : AttendanceCorrectionStatus.PENDING_APPROVAL,
        supervisorId: userRow?.supervisorId ?? null,
        decidedById,
        decidedAt,
        decisionNote:
          c.finalStatus === 'APPROVED' ? 'Verified via clock event log — approved.' : null,
      },
    });
  }

  // -------------------------------------------------------------------------
  // 18. Edge-case users — force-password-change, on-leave, terminated
  //     (soft-deleted). Kept minimal so mainline queries stay clean but
  //     the flows that filter on `mustChangePassword`, `employmentStatus`,
  //     and `deletedAt` all have at least one row to exercise.
  // -------------------------------------------------------------------------
  const engDeptId = deptByName.get('Engineering')!;
  const mktDeptId = deptByName.get('Marketing')!;
  const deptIdByName = new Map<string, string>([
    ['Engineering', engDeptId],
    ['Marketing', mktDeptId],
  ]);

  for (const eu of EDGE_USERS) {
    const supervisor = userByEmail.get(eu.supervisorEmail);
    const deptId = deptIdByName.get(eu.department);
    if (!deptId) continue;

    const user = await prisma.user.upsert({
      where: { companyId_email: { companyId: company.id, email: eu.email } },
      create: {
        companyId: company.id,
        departmentId: deptId,
        email: eu.email,
        passwordHash,
        fullName: eu.fullName,
        role: eu.role,
        hiredAt: new Date(eu.hiredAt),
        supervisorId: supervisor?.id,
        mustChangePassword: eu.mustChangePassword ?? false,
        employmentStatus: eu.employmentStatus ?? EmploymentStatus.ACTIVE,
        deletedAt: eu.deletedAt ? new Date(eu.deletedAt) : null,
      },
      update: {
        // Passwords: only reset for the mustChangePassword flow user because
        // an existing UAT tester may have already logged in and rotated the
        // pw for `mira` / `exit`. Reverting silently on re-seed would be
        // surprising.
        ...(eu.mustChangePassword ? { passwordHash, mustChangePassword: true } : {}),
        employmentStatus: eu.employmentStatus ?? EmploymentStatus.ACTIVE,
        deletedAt: eu.deletedAt ? new Date(eu.deletedAt) : null,
        supervisorId: supervisor?.id,
      },
      select: { id: true, role: true },
    });
    userByEmail.set(eu.email, user);

    // Only assign a shift for still-employed users (skip the terminated one).
    if (!eu.deletedAt) {
      const shiftId = shiftByName.get('Regular 9-6')!;
      const effectiveFrom = new Date(eu.hiredAt);
      const existing = await prisma.userShiftAssignment.findFirst({
        where: { userId: user.id, shiftId, effectiveFrom },
        select: { id: true },
      });
      if (!existing) {
        await prisma.userShiftAssignment.create({
          data: { userId: user.id, shiftId, effectiveFrom },
        });
      }
    }

    // Leave balances for non-terminated edge users too so the "quota is
    // configured" invariant holds tenant-wide.
    if (!eu.deletedAt) {
      for (const lt of leaveTypes) {
        await prisma.leaveBalance.upsert({
          where: {
            userId_leaveTypeId_year: { userId: user.id, leaveTypeId: lt.id, year },
          },
          create: {
            userId: user.id,
            leaveTypeId: lt.id,
            year,
            quota: lt.defaultAnnualQuota,
            used: 0,
            reserved: 0,
            carriedOver: 0,
            remaining: lt.defaultAnnualQuota,
          },
          update: {},
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Backfill `userByEmail` with baseline users created by `seed.ts` (which
  // runs BEFORE this UAT seed). The map is only populated with users this
  // seed inserted, so `employee@`, `hr@`, `lead@`, `admin@` are missing —
  // sections 19+ need those to attach timesheets, consents, and audit rows.
  // -------------------------------------------------------------------------
  {
    const baselineUsers = await prisma.user.findMany({
      where: { companyId: company.id, deletedAt: null },
      select: { id: true, email: true, role: true },
    });
    for (const u of baselineUsers) {
      if (!userByEmail.has(u.email)) {
        userByEmail.set(u.email, { id: u.id, role: u.role });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 19. Timesheet workflow — MONTHLY period for last month with 3 rows in
  //     different lifecycle states (PENDING_SUPERVISOR / PENDING_HR /
  //     APPROVED). Prerequisite for exercising the timesheet review inbox
  //     end-to-end without HR having to run generate-for-period first.
  // -------------------------------------------------------------------------
  {
    // Use "last month" relative to today, but always land on the 1st .. last-day-of-month.
    const nowLocal = new Date();
    const lastMonthEnd = new Date(Date.UTC(nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), 0));
    const lastMonthStart = new Date(
      Date.UTC(lastMonthEnd.getUTCFullYear(), lastMonthEnd.getUTCMonth(), 1),
    );

    await prisma.timesheetConfig.upsert({
      where: { companyId: company.id },
      create: {
        companyId: company.id,
        periodType: TimesheetPeriodType.MONTHLY,
        timezone: 'Asia/Jakarta',
      },
      update: {},
    });

    const monthLabel = lastMonthStart.toLocaleDateString('id-ID', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });

    const timesheetPeriod = await prisma.timesheetPeriod.upsert({
      where: {
        companyId_periodStart_periodEnd: {
          companyId: company.id,
          periodStart: lastMonthStart,
          periodEnd: lastMonthEnd,
        },
      },
      create: {
        companyId: company.id,
        periodType: TimesheetPeriodType.MONTHLY,
        periodStart: lastMonthStart,
        periodEnd: lastMonthEnd,
        label: monthLabel,
      },
      update: { label: monthLabel },
    });

    type TsSeed = {
      email: string;
      status: 'PENDING_SUPERVISOR' | 'PENDING_HR' | 'APPROVED';
    };
    const timesheetSeeds: TsSeed[] = [
      { email: 'employee@acme.test', status: 'PENDING_SUPERVISOR' },
      { email: 'siti.eng@acme.test', status: 'PENDING_HR' },
      { email: 'hr@acme.test', status: 'APPROVED' },
    ];

    // Precompute weekday list for the period so we can generate 1 entry per workday.
    const workdaysInPeriod: Date[] = [];
    for (
      let d = new Date(lastMonthStart);
      d <= lastMonthEnd;
      d = new Date(d.getTime() + 24 * 60 * 60 * 1000)
    ) {
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) workdaysInPeriod.push(new Date(d));
    }
    const totalWorkdays = workdaysInPeriod.length;

    // Find a supervisor and an HR to attribute the workflow decisions to.
    const engSupervisor = await prisma.user.findFirst({
      where: { companyId: company.id, email: 'lead@acme.test' },
      select: { id: true },
    });
    const hrManager = await prisma.user.findFirst({
      where: { companyId: company.id, email: 'hr@acme.test' },
      select: { id: true },
    });

    for (const t of timesheetSeeds) {
      const user = userByEmail.get(t.email);
      if (!user) continue;

      const status =
        t.status === 'APPROVED'
          ? TimesheetStatus.APPROVED
          : t.status === 'PENDING_HR'
            ? TimesheetStatus.PENDING_HR
            : TimesheetStatus.PENDING_SUPERVISOR;

      const submittedAt = new Date(lastMonthEnd.getTime() + 24 * 60 * 60 * 1000); // period+1
      const supervisorAt =
        t.status !== 'PENDING_SUPERVISOR'
          ? new Date(submittedAt.getTime() + 3 * 60 * 60 * 1000)
          : null;
      const hrManagerAt =
        t.status === 'APPROVED' ? new Date(submittedAt.getTime() + 24 * 60 * 60 * 1000) : null;

      // Rollups — 8h regular per weekday.
      const totalRegular = new Prisma.Decimal(totalWorkdays * 8);

      const timesheet = await prisma.timesheet.upsert({
        where: {
          userId_periodId: { userId: user.id, periodId: timesheetPeriod.id },
        },
        create: {
          companyId: company.id,
          userId: user.id,
          periodId: timesheetPeriod.id,
          status,
          totalRegularHours: totalRegular,
          totalOvertimeHours: '0',
          totalLeaveDays: 0,
          totalAbsentDays: 0,
          totalHolidays: 0,
          totalWorkingDays: totalWorkdays,
          totalLateMinutes: 0,
          totalEarlyLeaveMinutes: 0,
          submittedAt,
          supervisorId: engSupervisor?.id ?? null,
          supervisorAt,
          supervisorNote: supervisorAt ? 'Reviewed — hours look correct.' : null,
          hrManagerId: hrManagerAt ? (hrManager?.id ?? null) : null,
          hrManagerAt,
          hrManagerNote: hrManagerAt ? 'Approved for payroll cycle.' : null,
        },
        update: {},
      });

      // TimesheetEntry rows — idempotent by (timesheetId, workDate).
      for (const workDate of workdaysInPeriod) {
        await prisma.timesheetEntry.upsert({
          where: {
            timesheetId_workDate: { timesheetId: timesheet.id, workDate },
          },
          create: {
            timesheetId: timesheet.id,
            workDate,
            kind: TimesheetEntryKind.WORKING,
            expectedHours: '8.00',
            regularHours: '8.00',
            overtimeHours: '0',
            leaveHours: '0',
            lateMinutes: 0,
            earlyLeaveMinutes: 0,
            note: null,
          },
          update: {},
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 20. Overdue overtime backlog — 3 PENDING_APPROVAL rows filed 22, 28,
  //     and 35 days ago. Exercises the "backlog approval" queue in the
  //     supervisor / HR dashboards which highlights aging pending items.
  //     Note: `overtimeSubmitWindowDays` in seed's company config is 14,
  //     which means these were submitted RETROACTIVELY (e.g. via HR
  //     override) — a valid production scenario for late payroll fixes.
  // -------------------------------------------------------------------------
  type OverdueOtSeed = {
    userEmail: string;
    workDateOffsetDays: number;
    hours: string;
    reason: string;
  };
  const OVERDUE_OTS: readonly OverdueOtSeed[] = [
    {
      userEmail: 'lina.mkt@acme.test',
      workDateOffsetDays: 22,
      hours: '2.5',
      reason: 'Overdue submit — was on sick leave the week of',
    },
    {
      userEmail: 'bagus.mkt@acme.test',
      workDateOffsetDays: 28,
      hours: '3.0',
      reason: 'Missed submit — sprint retro slipped',
    },
    {
      userEmail: 'tia.ops@acme.test',
      workDateOffsetDays: 35,
      hours: '2.0',
      reason: 'Warehouse audit backlog — approver was on leave',
    },
  ];

  for (const ot of OVERDUE_OTS) {
    const user = userByEmail.get(ot.userEmail);
    if (!user) continue;
    const workDate = daysAgoUtc(ot.workDateOffsetDays);

    const dupe = await prisma.overtimeRequest.findFirst({
      where: {
        userId: user.id,
        workDate,
        status: {
          in: [
            OvertimeStatus.PENDING_APPROVAL,
            OvertimeStatus.APPROVED,
            OvertimeStatus.COMPLETED,
            OvertimeStatus.REJECTED,
          ],
        },
      },
      select: { id: true },
    });
    if (dupe) continue;

    const isWeekend = [0, 6].includes(workDate.getUTCDay());
    const multiplier = isWeekend ? 2 : 1.5;
    const ratePerHour = 50000 * multiplier;
    const totalAmount = ratePerHour * Number(ot.hours);

    // Backdate the createdAt via a raw update after insert — Prisma refuses
    // to set `createdAt` at create-time for models that use @default(now()).
    const created = await prisma.overtimeRequest.create({
      data: {
        companyId: company.id,
        userId: user.id,
        workDate,
        hours: ot.hours,
        reason: ot.reason,
        status: OvertimeStatus.PENDING_APPROVAL,
        baseRate: '50000',
        rateMultiplier: multiplier.toString(),
        ratePerHour: ratePerHour.toString(),
        totalAmount: totalAmount.toString(),
      },
    });

    // Force createdAt to the workDate + 1 so the aging calculation actually
    // shows a stale row (default now() would make it look freshly filed).
    const backdatedCreatedAt = new Date(workDate);
    backdatedCreatedAt.setUTCDate(backdatedCreatedAt.getUTCDate() + 1);
    await prisma.$executeRaw`
      UPDATE "OvertimeRequest"
      SET "createdAt" = ${backdatedCreatedAt}
      WHERE id = ${created.id}
    `;
  }

  // -------------------------------------------------------------------------
  // 21. MFA-enabled user — `hr2@acme.test` gets a fixed test TOTP secret
  //     so a UAT tester can add the same key to any authenticator app
  //     and verify. Requires MFA_SECRET_ENCRYPTION_KEY in the process env
  //     (the seed skips gracefully with a warning if it's missing).
  //
  //     TOTP secret used: `JBSWY3DPEHPK3PXP` — the classic RFC 6238 test
  //     vector. Compatible with Google Authenticator, Authy, 1Password,
  //     and every other TOTP client. Do NOT reuse in production.
  // -------------------------------------------------------------------------
  {
    const mfaKey = process.env.MFA_SECRET_ENCRYPTION_KEY;
    if (!mfaKey) {
      // eslint-disable-next-line no-console
      console.warn(
        '[seed-uat] MFA_SECRET_ENCRYPTION_KEY not set — skipping MFA-enabled user seed',
      );
    } else {
      try {
        const key = decodeEncryptionKey(mfaKey);
        const testTotpSecret = 'JBSWY3DPEHPK3PXP'; // RFC 6238 test vector — base32
        const encryptedSecret = encryptString(testTotpSecret, key);

        const mfaTargetEmail = 'hr2@acme.test';
        const mfaUser = await prisma.user.findFirst({
          where: { companyId: company.id, email: mfaTargetEmail },
          select: { id: true, mfaEnabledAt: true },
        });
        if (mfaUser && !mfaUser.mfaEnabledAt) {
          await prisma.user.update({
            where: { id: mfaUser.id },
            data: {
              mfaSecret: encryptedSecret,
              mfaEnabledAt: daysAgoUtc(30),
            },
          });
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          '[seed-uat] MFA seed skipped — could not enroll user:',
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // 22. Privacy Policy versions + consents — v1 accepted by everyone (from
  //     initial onboarding), v2 published recently and only some users
  //     have accepted. The rest will be force-routed to `/consent` on
  //     next login. Exercises the mandatory-consent auth gate.
  // -------------------------------------------------------------------------
  const policyV1 = await prisma.privacyPolicy.upsert({
    where: { companyId_version: { companyId: company.id, version: '1.0' } },
    create: {
      companyId: company.id,
      version: '1.0',
      title: 'Kebijakan Privasi Workpulse — Rev 1',
      body: [
        'Kebijakan Privasi awal untuk penggunaan sistem Workpulse.',
        '',
        'Data yang dikumpulkan: nama, email, jam kerja, lokasi clock-in.',
        'Retensi: 2 tahun untuk data attendance, 7 tahun untuk audit log.',
        'Dasar hukum: kontrak kerja (Pasal 20 UU PDP).',
      ].join('\n'),
      effectiveAt: new Date('2026-01-01T00:00:00Z'),
    },
    update: {},
  });

  const policyV2 = await prisma.privacyPolicy.upsert({
    where: { companyId_version: { companyId: company.id, version: '2.0' } },
    create: {
      companyId: company.id,
      version: '2.0',
      title: 'Kebijakan Privasi Workpulse — Rev 2 (UU PDP)',
      body: [
        'Update Kebijakan Privasi — kepatuhan UU PDP.',
        '',
        'Perubahan sejak Rev 1:',
        '- Menambahkan hak subjek data (akses, koreksi, hapus).',
        '- Memperjelas kategori data (data pribadi umum vs data spesifik).',
        '- Menetapkan DPO sebagai kontak resmi.',
      ].join('\n'),
      effectiveAt: daysAgoUtc(5),
    },
    update: {},
  });

  // Users who have accepted v2 (the rest will hit /consent on next login).
  // NOTE: `hr2@acme.test` is included even though it's the MFA-enabled demo
  // user — otherwise the MFA verify flow surfaces the consent gate mid-login,
  // which is confusing for UAT testers who just want to demo the TOTP path.
  // A separate cohort of ~29 users still hits /consent for that scenario.
  const CONSENTED_TO_V2 = new Set([
    'employee@acme.test',
    'hr@acme.test',
    'hr2@acme.test',
    'lead@acme.test',
    'siti.eng@acme.test',
    'admin@acme.test',
  ]);

  for (const [email, u] of userByEmail.entries()) {
    // v1 — everyone historically accepted 6 months ago
    await prisma.userConsent.upsert({
      where: { userId_policyId: { userId: u.id, policyId: policyV1.id } },
      create: {
        userId: u.id,
        policyId: policyV1.id,
        companyId: company.id,
        acceptedAt: new Date('2026-01-15T09:00:00Z'),
        ip: '127.0.0.1',
        userAgent: 'Chrome/UAT-seed',
      },
      update: {},
    });

    if (CONSENTED_TO_V2.has(email)) {
      await prisma.userConsent.upsert({
        where: { userId_policyId: { userId: u.id, policyId: policyV2.id } },
        create: {
          userId: u.id,
          policyId: policyV2.id,
          companyId: company.id,
          acceptedAt: daysAgoUtc(3),
          ip: '127.0.0.1',
          userAgent: 'Chrome/UAT-seed',
        },
        update: {},
      });
    }
  }

  // -------------------------------------------------------------------------
  // 23. Audit log — sample entries showing what the immutable log looks
  //     like for real business events. Idempotent via a marker note in
  //     `afterJson` we check on subsequent runs.
  // -------------------------------------------------------------------------
  const auditMarker = 'seed-uat:v1';
  const alreadySeededAudit = await prisma.auditLog.count({
    where: {
      companyId: company.id,
      afterJson: { path: ['_seedMarker'], equals: auditMarker },
    },
  });
  if (alreadySeededAudit === 0) {
    const adminId = (
      await prisma.user.findFirst({
        where: { companyId: company.id, email: 'admin@acme.test' },
        select: { id: true },
      })
    )?.id;
    const hrId = (
      await prisma.user.findFirst({
        where: { companyId: company.id, email: 'hr@acme.test' },
        select: { id: true },
      })
    )?.id;
    const supervisorId = (
      await prisma.user.findFirst({
        where: { companyId: company.id, email: 'lead@acme.test' },
        select: { id: true },
      })
    )?.id;

    const empId = userByEmail.get('employee@acme.test')?.id;
    const siti = userByEmail.get('siti.eng@acme.test')?.id;

    type AuditSeed = {
      actorId: string | null;
      action: string;
      entityType: string;
      entityId: string;
      before?: Record<string, unknown>;
      after: Record<string, unknown>;
      daysAgo: number;
    };
    const AUDIT_SEEDS: AuditSeed[] = [
      {
        actorId: hrId ?? null,
        action: 'RETENTION_POLICY_UPDATE',
        entityType: 'RetentionPolicy',
        entityId: 'company',
        before: { attendanceRetentionDays: 730 },
        after: { attendanceRetentionDays: 1095, _seedMarker: auditMarker },
        daysAgo: 20,
      },
      {
        actorId: hrId ?? null,
        action: 'LEAVE_APPROVED',
        entityType: 'LeaveRequest',
        entityId: 'seed-lr-1',
        after: { userId: empId, days: 3, _seedMarker: auditMarker },
        daysAgo: 12,
      },
      {
        actorId: supervisorId ?? null,
        action: 'OVERTIME_APPROVED',
        entityType: 'OvertimeRequest',
        entityId: 'seed-ot-1',
        after: { userId: siti, hours: '2.0', _seedMarker: auditMarker },
        daysAgo: 8,
      },
      {
        actorId: adminId ?? null,
        action: 'GEOFENCE_UPDATED',
        entityType: 'Geofence',
        entityId: 'HQ LA TBS',
        before: { radiusMeters: 150 },
        after: { radiusMeters: 200, _seedMarker: auditMarker },
        daysAgo: 5,
      },
      {
        actorId: null, // system actor — cron
        action: 'ATTENDANCE_AUTO_ABSENT_SCAN',
        entityType: 'AttendanceRecord',
        entityId: 'batch',
        after: {
          scannedDays: 1,
          markedAbsent: 0,
          _seedMarker: auditMarker,
        },
        daysAgo: 1,
      },
      {
        actorId: hrId ?? null,
        action: 'USER_PASSWORD_RESET_FORCED',
        entityType: 'User',
        entityId: userByEmail.get('newbie.eng@acme.test')?.id ?? 'unknown',
        after: {
          reason: 'Onboarding — first-login password change enforced',
          _seedMarker: auditMarker,
        },
        daysAgo: 4,
      },
      {
        actorId: hrId ?? null,
        action: 'PRIVACY_POLICY_PUBLISHED',
        entityType: 'PrivacyPolicy',
        entityId: policyV2.id,
        after: { version: '2.0', _seedMarker: auditMarker },
        daysAgo: 5,
      },
    ];

    for (const a of AUDIT_SEEDS) {
      const createdAt = daysAgoUtc(a.daysAgo);
      const created = await prisma.auditLog.create({
        data: {
          companyId: company.id,
          actorId: a.actorId,
          action: a.action,
          entityType: a.entityType,
          entityId: a.entityId,
          beforeJson: a.before ? (a.before as Prisma.InputJsonValue) : undefined,
          afterJson: a.after as Prisma.InputJsonValue,
          ip: '127.0.0.1',
          userAgent: 'seed-uat',
        },
      });
      // Backdate createdAt so the log entries look historical, not seed-run-time.
      await prisma.$executeRaw`
        UPDATE "AuditLog" SET "createdAt" = ${createdAt} WHERE id = ${created.id}
      `;
    }
  }

  // -------------------------------------------------------------------------
  // 24. Notifications — unread nudges so the bell icon has a badge on
  //     first-login for both employees and approvers. Idempotency: skip
  //     if this exact (recipient, type, title) already exists.
  // -------------------------------------------------------------------------
  type NotifSeed = {
    recipientEmail: string;
    type: NotificationType;
    title: string;
    body: string;
    daysAgo: number;
    data?: Record<string, unknown>;
  };

  const NOTIFICATIONS: NotifSeed[] = [
    {
      recipientEmail: 'employee@acme.test',
      type: NotificationType.LEAVE_APPROVED_HR,
      title: 'Pengajuan cuti disetujui HR',
      body: 'Cuti tahunan 3 hari (12–14 Agustus) telah disetujui oleh HR Manager.',
      daysAgo: 1,
    },
    {
      recipientEmail: 'siti.eng@acme.test',
      type: NotificationType.OVERTIME_APPROVED,
      title: 'Lembur disetujui',
      body: 'Lembur 2 jam pada 31 Juli 2026 telah disetujui. Total: Rp 150.000.',
      daysAgo: 3,
    },
    {
      recipientEmail: 'andi.eng@acme.test',
      type: NotificationType.OVERTIME_COMPLETED,
      title: 'Lembur dibayarkan',
      body: 'Lembur 3.5 jam pada 11 Juli 2026 telah dibayarkan pada payroll bulan ini.',
      daysAgo: 5,
    },
    {
      recipientEmail: 'tono.eng@acme.test',
      type: NotificationType.LEAVE_REJECTED,
      title: 'Pengajuan cuti ditolak',
      body: 'Cuti 5 hari (26 Juli) ditolak. Alasan: Conflict with sprint delivery.',
      daysAgo: 8,
    },
    {
      recipientEmail: 'hr@acme.test',
      type: NotificationType.LEAVE_SUBMITTED,
      title: 'Cuti baru menunggu approval HR',
      body: 'Reza Firmansyah — 5 hari (26 Agustus). Klik untuk review.',
      daysAgo: 1,
    },
    {
      recipientEmail: 'hr@acme.test',
      type: NotificationType.TIMESHEET_SUBMITTED,
      title: 'Timesheet baru menunggu approval',
      body: 'HR Manager — periode Juli 2026 sudah selesai supervisor review.',
      daysAgo: 1,
    },
    {
      recipientEmail: 'lead@acme.test',
      type: NotificationType.LEAVE_SUBMITTED,
      title: 'Cuti tim menunggu approval',
      body: 'Siti Nurhaliza — 3 hari (12 Agustus). Klik untuk review.',
      daysAgo: 2,
    },
    {
      recipientEmail: 'lead@acme.test',
      type: NotificationType.OVERTIME_SUBMITTED,
      title: 'Pengajuan lembur baru',
      body: 'Andi Prasetyo — 2.5 jam (3 Agustus). Klik untuk review.',
      daysAgo: 2,
    },
  ];

  for (const n of NOTIFICATIONS) {
    const recipient = userByEmail.get(n.recipientEmail);
    if (!recipient) continue;

    const dupe = await prisma.notification.findFirst({
      where: {
        recipientId: recipient.id,
        type: n.type,
        title: n.title,
      },
      select: { id: true },
    });
    if (dupe) continue;

    const createdAt = daysAgoUtc(n.daysAgo);
    const created = await prisma.notification.create({
      data: {
        companyId: company.id,
        recipientId: recipient.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data ? (n.data as Prisma.InputJsonValue) : undefined,
      },
    });
    await prisma.$executeRaw`
      UPDATE "Notification" SET "createdAt" = ${createdAt} WHERE id = ${created.id}
    `;
  }

  // -------------------------------------------------------------------------
  // 25. Summary
  // -------------------------------------------------------------------------
  const counts = {
    departments: await prisma.department.count({ where: { companyId: company.id } }),
    shifts: await prisma.shift.count({ where: { companyId: company.id, deletedAt: null } }),
    users: await prisma.user.count({ where: { companyId: company.id, deletedAt: null } }),
    leaveBalances: await prisma.leaveBalance.count({
      where: { user: { companyId: company.id } },
    }),
    attendances: await prisma.attendanceRecord.count({ where: { companyId: company.id } }),
    holidays: await prisma.holiday.count({ where: { companyId: company.id } }),
    pendingLeaves: await prisma.leaveRequest.count({
      where: {
        companyId: company.id,
        status: { in: [LeaveStatus.PENDING_SUPERVISOR, LeaveStatus.PENDING_HR] },
      },
    }),
    approvedLeaves: await prisma.leaveRequest.count({
      where: { companyId: company.id, status: LeaveStatus.APPROVED },
    }),
    rejectedLeaves: await prisma.leaveRequest.count({
      where: { companyId: company.id, status: LeaveStatus.REJECTED },
    }),
    pendingOts: await prisma.overtimeRequest.count({
      where: { companyId: company.id, status: OvertimeStatus.PENDING_APPROVAL },
    }),
    approvedOts: await prisma.overtimeRequest.count({
      where: { companyId: company.id, status: OvertimeStatus.APPROVED },
    }),
    completedOts: await prisma.overtimeRequest.count({
      where: { companyId: company.id, status: OvertimeStatus.COMPLETED },
    }),
    rejectedOts: await prisma.overtimeRequest.count({
      where: { companyId: company.id, status: OvertimeStatus.REJECTED },
    }),
    corrections: await prisma.attendanceCorrection.count({ where: { companyId: company.id } }),
    edgeUsers: await prisma.user.count({
      where: {
        companyId: company.id,
        OR: [
          { mustChangePassword: true },
          { employmentStatus: { not: EmploymentStatus.ACTIVE } },
          { deletedAt: { not: null } },
        ],
      },
    }),
    timesheets: await prisma.timesheet.count({ where: { companyId: company.id } }),
    overdueOts: await prisma.overtimeRequest.count({
      where: {
        companyId: company.id,
        status: OvertimeStatus.PENDING_APPROVAL,
        createdAt: { lt: daysAgoUtc(14) },
      },
    }),
    mfaEnabledUsers: await prisma.user.count({
      where: { companyId: company.id, mfaEnabledAt: { not: null } },
    }),
    privacyPolicies: await prisma.privacyPolicy.count({ where: { companyId: company.id } }),
    userConsents: await prisma.userConsent.count({ where: { companyId: company.id } }),
    auditLogs: await prisma.auditLog.count({ where: { companyId: company.id } }),
    unreadNotifications: await prisma.notification.count({
      where: { companyId: company.id, readAt: null },
    }),
  };

  // eslint-disable-next-line no-console
  console.warn('[seed-uat] done', {
    company: company.slug,
    ...counts,
    passwordForAll: COMMON_PASSWORD,
  });
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
