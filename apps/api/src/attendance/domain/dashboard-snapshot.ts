/**
 * Pure roll-up of the HR company-wide attendance dashboard.
 *
 * The service supplies four unrelated datasets keyed by userId:
 *   1. Roster (every active employee for the tenant on that date).
 *   2. AttendanceRecord rows for the date.
 *   3. AbsenceRecord rows for the date.
 *   4. APPROVED LeaveRequest ids-set covering the date.
 *
 * These functions do the categorisation: exactly one status per user,
 * per date. Precedence (tighter → looser):
 *
 *   CLOCKED_IN  ─┐
 *   ABSENT      ─┼─ mutually exclusive; a user has one canonical state.
 *   ON_LEAVE    ─┘
 *   NOT_CLOCKED_IN  ← the "unknown / still-in-day" fallback.
 *
 * Departments are aggregated in the same pass so the caller doesn't
 * need a second traversal.
 */

export type DashboardStatus =
  | 'CLOCKED_IN'
  | 'ABSENT'
  | 'ON_LEAVE'
  | 'NOT_CLOCKED_IN';

export interface RosterRow {
  userId: string;
  departmentId: string | null;
  departmentName: string | null;
}

export interface AttendanceRow {
  userId: string;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  status: string; // AttendanceStatus enum (may include LATE/EARLY_LEAVE/ON_TIME)
}

export interface AbsenceRow {
  userId: string;
}

export interface DashboardTotals {
  total: number;
  clockedIn: number;
  absent: number;
  onLeave: number;
  notClockedIn: number;
  lateToday: number;
  earlyLeaveToday: number;
  onTimeRatePercent: number | null;
}

export interface DepartmentSnapshot extends DashboardTotals {
  departmentId: string | null;
  departmentName: string | null;
}

export interface CompanySnapshot extends DashboardTotals {
  departments: DepartmentSnapshot[];
}

const UNASSIGNED_DEPT_LABEL = '(Tanpa departemen)';

export function buildCompanySnapshot(
  roster: RosterRow[],
  attendance: AttendanceRow[],
  absences: AbsenceRow[],
  onLeaveUserIds: readonly string[],
): CompanySnapshot {
  const clockedInIds = new Set(attendance.map((r) => r.userId));
  const absentIds = new Set(absences.map((r) => r.userId));
  const onLeaveIds = new Set(onLeaveUserIds);
  const lateIds = new Set(
    attendance.filter((r) => r.lateMinutes > 0).map((r) => r.userId),
  );
  const earlyIds = new Set(
    attendance.filter((r) => r.earlyLeaveMinutes > 0).map((r) => r.userId),
  );

  // Accumulator per department (key = departmentId ?? null-sentinel string)
  const NULL_KEY = '__null__';
  const deptAcc = new Map<string, DepartmentSnapshot>();

  // Company-level totals, computed alongside per-department for a single pass.
  const company: DashboardTotals = zeroTotals();

  for (const m of roster) {
    const status = classify(m.userId, clockedInIds, absentIds, onLeaveIds);
    const isLate = lateIds.has(m.userId);
    const isEarly = earlyIds.has(m.userId);

    // Company bucket
    incrementCounters(company, status, isLate, isEarly);

    // Department bucket
    const key = m.departmentId ?? NULL_KEY;
    let bucket = deptAcc.get(key);
    if (!bucket) {
      bucket = {
        departmentId: m.departmentId ?? null,
        departmentName: m.departmentName ?? (m.departmentId ? null : UNASSIGNED_DEPT_LABEL),
        ...zeroTotals(),
      };
      deptAcc.set(key, bucket);
    }
    incrementCounters(bucket, status, isLate, isEarly);
  }

  // Finalise on-time rate per bucket + sort departments by exception rate desc.
  company.onTimeRatePercent = onTimeRate(company);
  const departments = [...deptAcc.values()]
    .map((b) => ({ ...b, onTimeRatePercent: onTimeRate(b) }))
    .sort((a, b) => {
      // Departments with more exceptions (absent + late) sort first.
      const aEx = a.absent + a.lateToday;
      const bEx = b.absent + b.lateToday;
      if (aEx !== bEx) return bEx - aEx;
      const aName = a.departmentName ?? '';
      const bName = b.departmentName ?? '';
      return aName.localeCompare(bName, 'id');
    });

  return { ...company, departments };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function classify(
  userId: string,
  clockedIn: Set<string>,
  absent: Set<string>,
  onLeave: Set<string>,
): DashboardStatus {
  if (clockedIn.has(userId)) return 'CLOCKED_IN';
  if (absent.has(userId)) return 'ABSENT';
  if (onLeave.has(userId)) return 'ON_LEAVE';
  return 'NOT_CLOCKED_IN';
}

function zeroTotals(): DashboardTotals {
  return {
    total: 0,
    clockedIn: 0,
    absent: 0,
    onLeave: 0,
    notClockedIn: 0,
    lateToday: 0,
    earlyLeaveToday: 0,
    onTimeRatePercent: null,
  };
}

function incrementCounters(
  bucket: DashboardTotals,
  status: DashboardStatus,
  isLate: boolean,
  isEarly: boolean,
): void {
  bucket.total += 1;
  if (status === 'CLOCKED_IN') bucket.clockedIn += 1;
  else if (status === 'ABSENT') bucket.absent += 1;
  else if (status === 'ON_LEAVE') bucket.onLeave += 1;
  else bucket.notClockedIn += 1;
  if (isLate) bucket.lateToday += 1;
  if (isEarly) bucket.earlyLeaveToday += 1;
}

/**
 * On-time rate = (clockedIn - late - earlyLeave) / clockedIn.
 * Returns `null` when nobody clocked in (avoid dividing by zero).
 */
function onTimeRate(t: DashboardTotals): number | null {
  if (t.clockedIn === 0) return null;
  const onTime = t.clockedIn - t.lateToday - t.earlyLeaveToday;
  return Math.round((Math.max(0, onTime) / t.clockedIn) * 1000) / 10;
}
