/**
 * Pure helpers for the auto-absent scheduler.
 *
 * The scheduler service composes these with I/O (Prisma reads/writes,
 * notification dispatch). Everything below is deterministic given its
 * inputs — no `Date.now()`, no logging, no throwing on business
 * classification (only on programmer errors like malformed dates).
 *
 * ## Concepts
 *
 * - **Target date.** The most recent calendar day *in tenant timezone*
 *   that is fully in the past by at least `graceHours`. So at
 *   09:00 Asia/Jakarta on 2026-08-02 with `graceHours=6`, the target
 *   date is `2026-08-01` (yesterday) because we are >6h past its end.
 * - **Working day.** For MVP: Mon–Fri and not a company holiday. Shift
 *   rotations that legitimately work weekends are handled by the fact
 *   that a `UserShiftAssignment` covering the target date only means
 *   "user CAN work this shift"; we require the shift AND the day-of-week
 *   to line up. A future extension can add `Shift.workingDays` and
 *   route through the shift's own calendar.
 * - **Expected to work.** User is ACTIVE, hired on or before the target
 *   date, and has a `UserShiftAssignment` covering the target date.
 * - **Absent.** Expected to work, no `AttendanceRecord`, no APPROVED
 *   `LeaveRequest` covering the date. Everything else is skipped with
 *   a documented reason for observability.
 */

import type { CalendarDate } from '../../leave/domain/calendar-date';
import { assertCalendarDate, dayOfWeek } from '../../leave/domain/calendar-date';

// ---------------------------------------------------------------------------
// Target date resolution
// ---------------------------------------------------------------------------

/**
 * Given the current wall-clock `now` and a tenant's timezone, return the
 * most recent calendar day in that timezone that has been over
 * `graceHours` in the past. Returns `null` if the grace hasn't yet
 * elapsed for the previous day (i.e. still too early to scan).
 *
 * The `graceHours` window prevents premature classification when a
 * legitimate late-clock-in is still likely (e.g. mobile connectivity
 * gap, timesheet correction from supervisor).
 */
export function resolveTargetDate(
  now: Date,
  timezone: string,
  graceHours: number,
): CalendarDate | null {
  // Step 1: figure out "what is the current calendar date in `timezone`?"
  //         Using en-CA locale gives us YYYY-MM-DD directly.
  const todayLocal = formatInTimezone(now, timezone);

  // Step 2: how many hours into `todayLocal` are we? If < graceHours we
  //         cannot yet scan yesterday (which is `todayLocal - 1 day`) —
  //         it's already past midnight but the buffer hasn't elapsed.
  const hoursIntoToday = tenantLocalHours(now, timezone);
  if (hoursIntoToday < graceHours) return null;

  // Step 3: yesterday in tenant tz is our target.
  return subtractDays(todayLocal, 1);
}

/**
 * Compute every calendar date the scanner should backfill for a tenant
 * whose last scan was `lastScanned` (or null → never scanned before).
 * Capped at `maxBackfillDays` so a stale tenant doesn't lock the loop.
 */
export function pendingScanDates(
  targetDate: CalendarDate,
  lastScanned: CalendarDate | null,
  maxBackfillDays: number,
): CalendarDate[] {
  assertCalendarDate(targetDate);
  const cap = Math.max(0, maxBackfillDays);
  const earliest = subtractDays(targetDate, cap - 1);
  const firstEligible =
    lastScanned === null ? earliest : maxDate(subtractDays(lastScanned, 0), earliest);
  const start = firstEligible <= earliest ? earliest : addDays(firstEligible, 1);
  return datesBetween(start, targetDate);
}

// ---------------------------------------------------------------------------
// Per-user classification
// ---------------------------------------------------------------------------

export type AbsenceDecision = { kind: 'ABSENT' } | { kind: 'SKIP'; reason: AbsenceSkipReason };

export type AbsenceSkipReason =
  | 'NOT_HIRED_YET'
  | 'INACTIVE'
  | 'WEEKEND'
  | 'HOLIDAY'
  | 'NO_SHIFT_ASSIGNMENT'
  | 'CLOCKED_IN'
  | 'ON_APPROVED_LEAVE'
  | 'ALREADY_MARKED'
  /**
   * `workDate <= Company.payrollLockedUntil`. Emitted once per skipped
   * date (NOT per user, unlike the other reasons) — the scanner
   * short-circuits before loading the roster. See ADR-0010.
   */
  | 'PAYROLL_LOCKED';

export interface ClassifyAbsenceInput {
  targetDate: CalendarDate;
  /** ACTIVE/ON_LEAVE/SUSPENDED/TERMINATED. */
  employmentStatus: string;
  /** ISO YYYY-MM-DD of hire date; user is not classifiable before this. */
  hiredAt: CalendarDate;
  hasShiftAssignment: boolean;
  isHoliday: boolean;
  isWeekend: boolean;
  hasAttendance: boolean;
  hasApprovedLeave: boolean;
  hasExistingAbsence: boolean;
}

/**
 * Deterministic decision tree. Order of checks is chosen so the
 * `SKIP.reason` returned is the most specific/useful one:
 *
 *   1. Inactive / not-yet-hired short-circuits everything.
 *   2. Weekend / holiday guard against overzealous marking.
 *   3. Shift assignment: no schedule means no expectation.
 *   4. Attendance / leave: legitimate reasons to skip.
 *   5. Idempotency: already-marked short-circuits.
 *   6. Otherwise: absent.
 */
export function classifyAbsence(input: ClassifyAbsenceInput): AbsenceDecision {
  if (input.employmentStatus === 'TERMINATED' || input.employmentStatus === 'SUSPENDED') {
    return { kind: 'SKIP', reason: 'INACTIVE' };
  }
  if (input.hiredAt > input.targetDate) {
    return { kind: 'SKIP', reason: 'NOT_HIRED_YET' };
  }
  if (input.isWeekend) return { kind: 'SKIP', reason: 'WEEKEND' };
  if (input.isHoliday) return { kind: 'SKIP', reason: 'HOLIDAY' };
  if (!input.hasShiftAssignment) {
    return { kind: 'SKIP', reason: 'NO_SHIFT_ASSIGNMENT' };
  }
  if (input.hasAttendance) return { kind: 'SKIP', reason: 'CLOCKED_IN' };
  if (input.hasApprovedLeave) {
    return { kind: 'SKIP', reason: 'ON_APPROVED_LEAVE' };
  }
  if (input.hasExistingAbsence) {
    return { kind: 'SKIP', reason: 'ALREADY_MARKED' };
  }
  return { kind: 'ABSENT' };
}

/** Convenience for the service — returns true iff `dayOfWeek(d)` is Sat/Sun. */
export function isWeekendDate(date: CalendarDate): boolean {
  const dow = dayOfWeek(date);
  return dow === 0 || dow === 6;
}

// ---------------------------------------------------------------------------
// Small calendar helpers (kept local to avoid coupling the leave domain)
// ---------------------------------------------------------------------------

function subtractDays(date: CalendarDate, n: number): CalendarDate {
  return addDays(date, -n);
}

function addDays(date: CalendarDate, n: number): CalendarDate {
  assertCalendarDate(date);
  const [ys, ms, ds] = date.split('-').map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(ys, ms - 1, ds));
  utc.setUTCDate(utc.getUTCDate() + n);
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utc.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function datesBetween(start: CalendarDate, end: CalendarDate): CalendarDate[] {
  assertCalendarDate(start);
  assertCalendarDate(end);
  if (end < start) return [];
  const out: CalendarDate[] = [];
  let cursor = start;
  while (cursor <= end) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

function maxDate(a: CalendarDate, b: CalendarDate): CalendarDate {
  return a > b ? a : b;
}

/** Format a `Date` as `YYYY-MM-DD` in the given IANA timezone. */
function formatInTimezone(now: Date, timezone: string): CalendarDate {
  // `en-CA` locale renders dates as `YYYY-MM-DD` unambiguously.
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now) as CalendarDate;
}

/**
 * Hours (fractional) elapsed since local midnight in `timezone`.
 * E.g. 03:30 local → 3.5.
 */
function tenantLocalHours(now: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  // Intl sometimes renders `24:00:00` at exact midnight — normalise to 0.
  const h = get('hour') % 24;
  const m = get('minute');
  const s = get('second');
  return h + m / 60 + s / 3600;
}
