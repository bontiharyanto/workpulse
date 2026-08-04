/**
 * Pure helpers for team-level attendance roll-ups.
 *
 * The service layer supplies:
 *   1. The full roster (all team members the actor is allowed to see).
 *   2. Any attendance records that exist for the target range.
 *
 * These functions do the "left join in memory": every roster entry
 * produces exactly one output row, filled with `null`/`ABSENT` sentinels
 * when the person didn't clock in.
 *
 * Kept framework-free so we can reuse the same reducer for
 * supervisor-scoped and tenant-wide (HR) endpoints — the shape of the
 * output is identical, only the roster differs.
 */

export type TeamAttendanceStatus =
  | 'ON_TIME'
  | 'LATE'
  | 'EARLY_LEAVE'
  | 'ABSENT'
  | 'ON_LEAVE'
  /** No AttendanceRecord row exists for this date. Different from ABSENT which is HR/cron-set. */
  | 'NOT_CLOCKED_IN';

// ---------------------------------------------------------------------------
// Daily "who's in right now" snapshot
// ---------------------------------------------------------------------------

export interface RosterMember {
  userId: string;
  fullName: string;
  email: string;
  departmentName: string | null;
}

export interface DailyAttendanceInput {
  userId: string;
  status: string; // Prisma enum-as-string
  clockInAt: Date;
  clockOutAt: Date | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
}

export interface TeamMemberDailyRow {
  userId: string;
  fullName: string;
  email: string;
  departmentName: string | null;
  status: TeamAttendanceStatus;
  clockInAt: string | null; // ISO
  clockOutAt: string | null; // ISO
  lateMinutes: number;
  earlyLeaveMinutes: number;
  /**
   * The AbsenceRecord row id backing this row's `ABSENT` status.
   * `null` for any status other than ABSENT.
   *
   * Consumed by HR UIs to render the "Batalkan absen" action — the
   * client can DELETE `/attendance/absence/:id` when this is non-null.
   */
  absenceRecordId: string | null;
  /**
   * Provenance of the ABSENT classification. `null` for non-absent
   * rows. Useful for UIs that want to distinguish "auto-scheduler
   * decided" vs "HR chose" at a glance.
   */
  absenceSource: 'AUTO_SCHEDULER' | 'MANUAL_HR' | null;
}

/**
 * Details of an AbsenceRecord row we need to display alongside the
 * team-daily row. The service layer fetches these rows separately
 * (grouped-by-user is not enough — we need id + source) and passes
 * them in here.
 */
export interface AbsenceOverlay {
  userId: string;
  absenceRecordId: string;
  source: 'AUTO_SCHEDULER' | 'MANUAL_HR';
}

export interface DailyViewOptions {
  /**
   * Full AbsenceRecord metadata for the target date. Rows are marked
   * `ABSENT` and receive the `absenceRecordId` + `absenceSource`
   * fields so HR can act on them.
   *
   * If a user has BOTH an AttendanceRecord and an AbsenceRecord (an
   * anomalous state — HR data-entry error), the AttendanceRecord
   * wins; the classification is dropped from the daily view (but
   * remains in the DB for HR to reconcile).
   *
   * Callers that don't have absence metadata yet may still pass
   * `absentUserIds` — kept as a legacy escape hatch so we don't have
   * to touch every call site. When both are present the richer
   * `absences` field takes precedence.
   */
  absences?: readonly AbsenceOverlay[];
  /** @deprecated pass `absences` for full metadata. */
  absentUserIds?: ReadonlySet<string> | readonly string[];
  /**
   * Set of userIds on APPROVED leave for the date. Marked `ON_LEAVE`
   * when no AttendanceRecord exists.
   */
  onLeaveUserIds?: ReadonlySet<string> | readonly string[];
}

/**
 * Build "today's view" of the team: one row per roster member, sorted by
 * status severity (LATE → EARLY_LEAVE → NOT_CLOCKED_IN → ON_TIME) so the
 * supervisor sees exceptions at the top.
 */
export function buildTeamDailyView(
  roster: RosterMember[],
  records: DailyAttendanceInput[],
  options: DailyViewOptions = {},
): TeamMemberDailyRow[] {
  const byUser = new Map<string, DailyAttendanceInput>();
  for (const r of records) byUser.set(r.userId, r);
  const absenceByUser = new Map<string, AbsenceOverlay>();
  for (const a of options.absences ?? []) absenceByUser.set(a.userId, a);
  const absentIds = new Set<string>([...absenceByUser.keys(), ...toSet(options.absentUserIds)]);
  const onLeaveIds = toSet(options.onLeaveUserIds);

  const rows: TeamMemberDailyRow[] = roster.map((m) => {
    const rec = byUser.get(m.userId);
    if (!rec) {
      // No attendance row → derive status from absence / leave data.
      const overlay = absenceByUser.get(m.userId);
      const derivedStatus: TeamAttendanceStatus = absentIds.has(m.userId)
        ? 'ABSENT'
        : onLeaveIds.has(m.userId)
          ? 'ON_LEAVE'
          : 'NOT_CLOCKED_IN';
      return {
        userId: m.userId,
        fullName: m.fullName,
        email: m.email,
        departmentName: m.departmentName,
        status: derivedStatus,
        clockInAt: null,
        clockOutAt: null,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        absenceRecordId: derivedStatus === 'ABSENT' ? (overlay?.absenceRecordId ?? null) : null,
        absenceSource: derivedStatus === 'ABSENT' ? (overlay?.source ?? null) : null,
      };
    }
    return {
      userId: m.userId,
      fullName: m.fullName,
      email: m.email,
      departmentName: m.departmentName,
      status: normalizeStatus(rec.status),
      clockInAt: rec.clockInAt.toISOString(),
      clockOutAt: rec.clockOutAt ? rec.clockOutAt.toISOString() : null,
      lateMinutes: rec.lateMinutes,
      earlyLeaveMinutes: rec.earlyLeaveMinutes,
      absenceRecordId: null,
      absenceSource: null,
    };
  });

  return rows.sort(compareByExceptionSeverity);
}

function toSet(input: ReadonlySet<string> | readonly string[] | undefined): Set<string> {
  if (!input) return new Set();
  if (input instanceof Set) return new Set(input);
  return new Set(input);
}

function normalizeStatus(raw: string): TeamAttendanceStatus {
  switch (raw) {
    case 'ON_TIME':
    case 'LATE':
    case 'EARLY_LEAVE':
    case 'ABSENT':
    case 'ON_LEAVE':
      return raw;
    default:
      return 'ABSENT';
  }
}

const SEVERITY: Record<TeamAttendanceStatus, number> = {
  LATE: 0,
  EARLY_LEAVE: 1,
  NOT_CLOCKED_IN: 2,
  ABSENT: 3,
  ON_LEAVE: 4,
  ON_TIME: 5,
};

function compareByExceptionSeverity(a: TeamMemberDailyRow, b: TeamMemberDailyRow): number {
  const diff = SEVERITY[a.status] - SEVERITY[b.status];
  if (diff !== 0) return diff;
  return a.fullName.localeCompare(b.fullName, 'id');
}

// ---------------------------------------------------------------------------
// Range summary (per-member roll-up over N days)
// ---------------------------------------------------------------------------

export interface RangeAttendanceInput {
  userId: string;
  status: string;
  clockInAt: Date;
  clockOutAt: Date | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
}

export interface TeamMemberSummaryRow {
  userId: string;
  fullName: string;
  email: string;
  departmentName: string | null;
  presentDays: number;
  onTimeDays: number;
  lateDays: number;
  earlyLeaveDays: number;
  absentDays: number;
  totalLateMinutes: number;
  totalEarlyLeaveMinutes: number;
  totalHoursWorked: number;
  onTimeRatePercent: number | null;
}

export interface TeamSummaryOptions {
  /**
   * userId → number of AbsenceRecord rows in the range. Extra keys
   * (users not in the roster) are ignored; missing keys default to 0.
   */
  absentDaysByUserId?: ReadonlyMap<string, number> | Record<string, number>;
}

/**
 * Aggregate per-user over a date range. The same on-time / late rules from
 * `summarizeAttendance` apply — a purely-early-leave day is NOT counted as
 * on-time — so the two endpoints (self summary and team summary) never
 * disagree for the same underlying rows.
 */
export function buildTeamSummary(
  roster: RosterMember[],
  records: RangeAttendanceInput[],
  options: TeamSummaryOptions = {},
): TeamMemberSummaryRow[] {
  const absentByUser = toAbsenceMap(options.absentDaysByUserId);
  // Prime the accumulator with a zero row per roster member so absent
  // people still show up (with all zeros).
  const acc = new Map<string, TeamMemberSummaryRow>();
  for (const m of roster) {
    acc.set(m.userId, {
      userId: m.userId,
      fullName: m.fullName,
      email: m.email,
      departmentName: m.departmentName,
      presentDays: 0,
      onTimeDays: 0,
      lateDays: 0,
      earlyLeaveDays: 0,
      absentDays: Math.max(0, Math.floor(absentByUser.get(m.userId) ?? 0)),
      totalLateMinutes: 0,
      totalEarlyLeaveMinutes: 0,
      totalHoursWorked: 0,
      onTimeRatePercent: null,
    });
  }

  // Hours accumulated in ms to avoid floating drift; converted at the end.
  const hoursMsByUser = new Map<string, number>();

  for (const r of records) {
    const row = acc.get(r.userId);
    if (!row) continue; // Record for someone not in roster → skip (RBAC belt-and-suspenders).
    if (r.status === 'ABSENT' || r.status === 'ON_LEAVE') continue;

    row.presentDays += 1;
    if (r.lateMinutes > 0) {
      row.lateDays += 1;
      row.totalLateMinutes += r.lateMinutes;
    } else if (r.earlyLeaveMinutes === 0) {
      row.onTimeDays += 1;
    }
    if (r.earlyLeaveMinutes > 0) {
      row.earlyLeaveDays += 1;
      row.totalEarlyLeaveMinutes += r.earlyLeaveMinutes;
    }

    if (r.clockOutAt) {
      const ms = r.clockOutAt.getTime() - r.clockInAt.getTime();
      hoursMsByUser.set(r.userId, (hoursMsByUser.get(r.userId) ?? 0) + ms);
    }
  }

  for (const row of acc.values()) {
    row.totalHoursWorked = round2((hoursMsByUser.get(row.userId) ?? 0) / 3_600_000);
    row.onTimeRatePercent =
      row.presentDays === 0 ? null : Math.round((row.onTimeDays / row.presentDays) * 1000) / 10;
  }

  // Sort by the same "exceptions on top" ordering — worst on-time rate
  // first, ties broken by lateDays desc, then name.
  return [...acc.values()].sort((a, b) => {
    const aRate = a.onTimeRatePercent ?? 101; // null → "clean" bucket
    const bRate = b.onTimeRatePercent ?? 101;
    if (aRate !== bRate) return aRate - bRate;
    if (a.lateDays !== b.lateDays) return b.lateDays - a.lateDays;
    return a.fullName.localeCompare(b.fullName, 'id');
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toAbsenceMap(
  input: ReadonlyMap<string, number> | Record<string, number> | undefined,
): Map<string, number> {
  if (!input) return new Map();
  if (input instanceof Map) return new Map(input);
  return new Map(Object.entries(input));
}
