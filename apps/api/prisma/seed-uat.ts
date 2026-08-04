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
  AttendanceStatus,
  EmploymentStatus,
  LeaveKind,
  LeaveStatus,
  OvertimeStatus,
  PrismaClient,
  ShiftType,
  UserRole,
} from '@prisma/client';
import argon2 from 'argon2';

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
  { email: 'siti.eng@acme.test', fullName: 'Siti Nurhaliza', role: UserRole.EMPLOYEE, department: 'Engineering', hiredAt: '2024-01-08', supervisorEmail: 'lead@acme.test' },
  { email: 'andi.eng@acme.test', fullName: 'Andi Prasetyo', role: UserRole.EMPLOYEE, department: 'Engineering', hiredAt: '2024-02-14', supervisorEmail: 'lead@acme.test' },
  { email: 'tono.eng@acme.test', fullName: 'Tono Hermawan', role: UserRole.EMPLOYEE, department: 'Engineering', hiredAt: '2024-03-20', supervisorEmail: 'lead@acme.test' },
  { email: 'sri.eng@acme.test', fullName: 'Sri Rahayu', role: UserRole.EMPLOYEE, department: 'Engineering', hiredAt: '2025-05-02', supervisorEmail: 'lead@acme.test' },
  { email: 'indah.eng@acme.test', fullName: 'Indah Permatasari', role: UserRole.EMPLOYEE, department: 'Engineering', hiredAt: '2025-08-15', supervisorEmail: 'lead@acme.test' },

  // ---- Finance (5) ----
  { email: 'rio.fin@acme.test', fullName: 'Rio Setiawan', role: UserRole.EMPLOYEE, department: 'Finance', hiredAt: '2023-11-05', supervisorEmail: 'budi.finance@acme.test' },
  { email: 'maya.fin@acme.test', fullName: 'Maya Puspita', role: UserRole.EMPLOYEE, department: 'Finance', hiredAt: '2024-04-11', supervisorEmail: 'budi.finance@acme.test' },
  { email: 'hendra.fin@acme.test', fullName: 'Hendra Kusuma', role: UserRole.EMPLOYEE, department: 'Finance', hiredAt: '2024-07-22', supervisorEmail: 'budi.finance@acme.test' },
  { email: 'putri.fin@acme.test', fullName: 'Putri Ayu Lestari', role: UserRole.EMPLOYEE, department: 'Finance', hiredAt: '2025-01-16', supervisorEmail: 'budi.finance@acme.test' },
  { email: 'dimas.fin@acme.test', fullName: 'Dimas Aditya', role: UserRole.EMPLOYEE, department: 'Finance', hiredAt: '2025-09-01', supervisorEmail: 'budi.finance@acme.test' },

  // ---- Marketing (5) ----
  { email: 'lina.mkt@acme.test', fullName: 'Lina Marlina', role: UserRole.EMPLOYEE, department: 'Marketing', hiredAt: '2023-09-14', supervisorEmail: 'dewi.marketing@acme.test' },
  { email: 'bagus.mkt@acme.test', fullName: 'Bagus Pratama', role: UserRole.EMPLOYEE, department: 'Marketing', hiredAt: '2024-05-30', supervisorEmail: 'dewi.marketing@acme.test' },
  { email: 'retno.mkt@acme.test', fullName: 'Retno Widyawati', role: UserRole.EMPLOYEE, department: 'Marketing', hiredAt: '2024-08-19', supervisorEmail: 'dewi.marketing@acme.test' },
  { email: 'joko.mkt@acme.test', fullName: 'Joko Susilo', role: UserRole.EMPLOYEE, department: 'Marketing', hiredAt: '2025-02-24', supervisorEmail: 'dewi.marketing@acme.test' },
  { email: 'ayu.mkt@acme.test', fullName: 'Ayu Wandira', role: UserRole.EMPLOYEE, department: 'Marketing', hiredAt: '2025-11-07', supervisorEmail: 'dewi.marketing@acme.test' },

  // ---- Operations (6, mixed shifts to exercise scheduling) ----
  { email: 'reza.ops@acme.test', fullName: 'Reza Firmansyah', role: UserRole.EMPLOYEE, department: 'Operations', hiredAt: '2023-07-04', supervisorEmail: 'agus.ops@acme.test', shift: 'Morning 7-4' },
  { email: 'dian.ops@acme.test', fullName: 'Dian Sastro', role: UserRole.EMPLOYEE, department: 'Operations', hiredAt: '2024-03-12', supervisorEmail: 'agus.ops@acme.test', shift: 'Morning 7-4' },
  { email: 'arief.ops@acme.test', fullName: 'Arief Budiman', role: UserRole.EMPLOYEE, department: 'Operations', hiredAt: '2024-06-18', supervisorEmail: 'agus.ops@acme.test', shift: 'Afternoon 12-9' },
  { email: 'nur.ops@acme.test', fullName: 'Nur Aisyah', role: UserRole.EMPLOYEE, department: 'Operations', hiredAt: '2024-10-08', supervisorEmail: 'agus.ops@acme.test', shift: 'Afternoon 12-9' },
  { email: 'iqbal.ops@acme.test', fullName: 'Iqbal Rahman', role: UserRole.EMPLOYEE, department: 'Operations', hiredAt: '2025-04-03', supervisorEmail: 'agus.ops@acme.test', shift: 'Night 22-7' },
  { email: 'tia.ops@acme.test', fullName: 'Tia Ramadhani', role: UserRole.EMPLOYEE, department: 'Operations', hiredAt: '2025-06-21', supervisorEmail: 'agus.ops@acme.test', shift: 'Night 22-7' },

  // ---- People & Culture (2) ----
  { email: 'eka.hr@acme.test', fullName: 'Eka Puspa Sari', role: UserRole.EMPLOYEE, department: 'People & Culture', hiredAt: '2024-01-22', supervisorEmail: 'sinta.hr@acme.test' },
  { email: 'farah.hr@acme.test', fullName: 'Farah Diba', role: UserRole.EMPLOYEE, department: 'People & Culture', hiredAt: '2025-03-10', supervisorEmail: 'sinta.hr@acme.test' },
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
      update: { geofenceId, breakMinutes: s.breakMinutes },
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
    const supervisor = person.supervisorEmail
      ? userByEmail.get(person.supervisorEmail)
      : undefined;
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
    const person =
      allPersons.find((p) => p.email === email) ??
      { shift: 'Regular 9-6' as const };
    const shiftName = person.shift ?? 'Regular 9-6';
    const shiftDef = SHIFTS.find((s) => s.name === shiftName)!;
    const shiftId = shiftByName.get(shiftName)!;
    const [shiftStartH, shiftStartM] = shiftDef.startTime.split(':').map(Number) as [number, number];
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
    { userEmail: 'siti.eng@acme.test', leaveTypeId: annual.id, startOffsetDays: 7, days: 3, reason: 'Family gathering out of town', stage: 'PENDING_SUPERVISOR' },
    { userEmail: 'rio.fin@acme.test', leaveTypeId: annual.id, startOffsetDays: 14, days: 2, reason: 'Personal appointment', stage: 'PENDING_SUPERVISOR' },
    { userEmail: 'lina.mkt@acme.test', leaveTypeId: sick.id, startOffsetDays: -1, days: 1, reason: 'Flu, doctor advised rest', stage: 'PENDING_SUPERVISOR' },
    { userEmail: 'reza.ops@acme.test', leaveTypeId: annual.id, startOffsetDays: 21, days: 5, reason: 'Annual vacation', stage: 'PENDING_HR' },
    { userEmail: 'eka.hr@acme.test', leaveTypeId: permit.id, startOffsetDays: 3, days: 1, reason: 'School meeting for child', stage: 'PENDING_HR' },
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
          status: req.stage === 'PENDING_HR' ? LeaveStatus.PENDING_HR : LeaveStatus.PENDING_SUPERVISOR,
          startDate,
          endDate,
          days: req.days,
          reason: req.reason,
          // For PENDING_HR we simulate that the supervisor already approved.
          supervisorId: req.stage === 'PENDING_HR' ? supervisor?.supervisorId ?? null : null,
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
    { userEmail: 'andi.eng@acme.test', workDateOffsetDays: 2, hours: '2.5', reason: 'Release cutover support' },
    { userEmail: 'maya.fin@acme.test', workDateOffsetDays: 3, hours: '3.0', reason: 'Month-end reconciliation' },
    { userEmail: 'dian.ops@acme.test', workDateOffsetDays: 1, hours: '1.5', reason: 'Warehouse stocktake' },
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
        status: { in: [OvertimeStatus.PENDING_APPROVAL, OvertimeStatus.APPROVED, OvertimeStatus.COMPLETED] },
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
  // 12. Summary
  // -------------------------------------------------------------------------
  const counts = {
    departments: await prisma.department.count({ where: { companyId: company.id } }),
    shifts: await prisma.shift.count({ where: { companyId: company.id, deletedAt: null } }),
    users: await prisma.user.count({ where: { companyId: company.id, deletedAt: null } }),
    leaveBalances: await prisma.leaveBalance.count({
      where: { user: { companyId: company.id } },
    }),
    attendances: await prisma.attendanceRecord.count({ where: { companyId: company.id } }),
    pendingLeaves: await prisma.leaveRequest.count({
      where: {
        companyId: company.id,
        status: { in: [LeaveStatus.PENDING_SUPERVISOR, LeaveStatus.PENDING_HR] },
      },
    }),
    pendingOts: await prisma.overtimeRequest.count({
      where: { companyId: company.id, status: OvertimeStatus.PENDING_APPROVAL },
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
