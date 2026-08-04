/**
 * Pure eligibility check for promoting an APPROVED overtime request to
 * COMPLETED via the daily scheduler. Kept separate from `overtime-state.ts`
 * because the state machine's `COMPLETE` event is untrusted (any caller could
 * emit it) — here we enforce the additional *system-only* preconditions:
 *
 *   1. Status must be exactly `APPROVED` (`COMPLETED` is idempotent-skip).
 *   2. `workDate + graceDays` must be strictly in the past — a request logged
 *      for today, or within the tenant's grace window, is NOT eligible even
 *      if attendance is already recorded. This gives late timesheet edits
 *      (supervisor logging Friday's OT on Monday) room to land before the
 *      scheduler decides.
 *   3. There must exist a non-deleted `AttendanceRecord` for `(userId, workDate)`
 *      with BOTH `clockInAt` and `clockOutAt` set — i.e. the user demonstrably
 *      worked a full session that day. Half-punches (clock-in only) are not
 *      accepted as proof of attendance for overtime payment.
 *
 * We return a `Skip` / `Eligible` discriminated union so the caller can log
 * *why* a row was skipped (helpful for HR when investigating stuck APPROVED
 * requests).
 */

export type OvertimeCompletionDecision =
  | { kind: 'ELIGIBLE' }
  | {
      kind: 'SKIP';
      reason:
        | 'ALREADY_COMPLETED'
        | 'NOT_APPROVED'
        | 'GRACE_NOT_MET'
        | 'NO_ATTENDANCE'
        | 'INCOMPLETE_ATTENDANCE'
        /**
         * `workDate <= Company.payrollLockedUntil`. Promoting APPROVED → COMPLETED
         * writes into a frozen period (COMPLETED is what payroll counts) — so the
         * scheduler must NOT auto-promote here. SUPER_ADMIN can still nudge via
         * a manual completion path (out of scope for the scheduler). ADR-0010
         * follow-up.
         */
        | 'PAYROLL_LOCKED';
    };

export interface OvertimeCompletionInput {
  status: string;
  workDate: Date;
  now: Date;
  graceDays: number;
  /** Attendance record for `(userId, workDate)`, or null if none exists. */
  attendance: {
    clockInAt: Date | null;
    clockOutAt: Date | null;
    deletedAt: Date | null;
  } | null;
}

export function decideOvertimeCompletion(
  input: OvertimeCompletionInput,
): OvertimeCompletionDecision {
  if (input.status === 'COMPLETED') {
    return { kind: 'SKIP', reason: 'ALREADY_COMPLETED' };
  }
  if (input.status !== 'APPROVED') {
    return { kind: 'SKIP', reason: 'NOT_APPROVED' };
  }

  // Grace check — compare on midnight-UTC boundaries so timezone-drift near
  // the international date line doesn't cause off-by-one completions.
  const cutoff = truncUtcDay(input.workDate);
  cutoff.setUTCDate(cutoff.getUTCDate() + input.graceDays);
  const today = truncUtcDay(input.now);
  if (today.getTime() <= cutoff.getTime()) {
    return { kind: 'SKIP', reason: 'GRACE_NOT_MET' };
  }

  const att = input.attendance;
  if (!att || att.deletedAt !== null) {
    return { kind: 'SKIP', reason: 'NO_ATTENDANCE' };
  }
  if (att.clockInAt === null || att.clockOutAt === null) {
    return { kind: 'SKIP', reason: 'INCOMPLETE_ATTENDANCE' };
  }

  return { kind: 'ELIGIBLE' };
}

function truncUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
