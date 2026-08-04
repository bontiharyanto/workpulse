/**
 * Pure predicate & guard for the "payroll frozen" invariant.
 *
 * Payroll close is a **hard operational contract** with finance: once a
 * period is closed, the rows underlying paychecks must not change (else
 * DB and paycheck disagree). We enforce that here — cross-module, since
 * closed periods affect attendance, leave, AND overtime — rather than as
 * a DB trigger because:
 *
 *   1. The error surface must be a specific HTTP code + message the FE
 *      can catch (`PAYROLL_LOCKED`); a Postgres CHECK violation would
 *      surface as a generic 500.
 *   2. `SUPER_ADMIN` retains an emergency-override lane for genuine
 *      correction scenarios (auditor amendment, misconfiguration
 *      recovery). Encoding role-aware bypass at the DB layer would be
 *      awkward.
 *
 * Kept framework-free so the same predicate can be reused by the
 * auto-scheduler (which needs to SKIP rather than THROW) and by
 * imperative controllers (which THROW).
 *
 * ## Home
 *
 * Originally lived under `attendance/domain/`. Moved here in Phase 18
 * (ADR-0010 follow-up) once we started guarding leave and overtime
 * mutations too — the concept is orthogonal to attendance.
 */

export type Role = 'EMPLOYEE' | 'SUPERVISOR' | 'HR_MANAGER' | 'SUPER_ADMIN';

/**
 * Actor identity subset relevant to the cutoff check. Kept minimal so
 * unit tests don't have to construct the full `AuthenticatedUser`.
 */
export interface CutoffActor {
  role: Role;
}

/**
 * Predicate: is `targetDate` inside a frozen payroll period for this
 * tenant? Returns `false` for a null cutoff (no period ever closed)
 * or for dates strictly after the cutoff.
 *
 * `payrollLockedUntil` is **inclusive** — a cutoff of 2026-07-31 means
 * every day up to and including 2026-07-31 is frozen. Chosen so that
 * "close the July payroll" is a natural, off-by-one-free operation
 * (set cutoff to the last day of July, not "the first day of August").
 *
 * Comparison is by UTC calendar day. Callers MUST have already
 * normalized both dates via `truncateToUtcDate` (which each module's
 * `parseIsoDate` helper does implicitly).
 */
export function isPayrollLocked(
  targetDate: Date,
  payrollLockedUntil: Date | null | undefined,
): boolean {
  if (!payrollLockedUntil) return false;
  // Compare timestamps of midnight UTC — `@db.Date` in Postgres arrives
  // as a Date at 00:00:00Z, so this is a whole-day comparison.
  return targetDate.getTime() <= payrollLockedUntil.getTime();
}

/**
 * Same predicate BUT respects SUPER_ADMIN override. HR_MANAGER (the
 * standard operator role) is treated as blocked; only SUPER_ADMIN can
 * bypass. Rationale: HR should ask the payroll owner (or the auditor)
 * before touching a closed period; a SUPER_ADMIN escalation is the
 * paper trail.
 *
 * Returns `true` when the mutation MUST be refused.
 */
export function isMutationBlockedByPayrollLock(
  targetDate: Date,
  payrollLockedUntil: Date | null | undefined,
  actor: CutoffActor,
): boolean {
  if (!isPayrollLocked(targetDate, payrollLockedUntil)) return false;
  return actor.role !== 'SUPER_ADMIN';
}

/**
 * Custom error emitted when the cutoff blocks a mutation. Uses a
 * stable, machine-parseable code — the controller / global filter
 * maps this to a 409 CONFLICT with `{ code: 'PAYROLL_LOCKED' }`.
 *
 * We use a plain Error subclass (not a Nest HttpException) so the
 * domain module stays framework-independent.
 */
export class PayrollLockedError extends Error {
  readonly code = 'PAYROLL_LOCKED';
  constructor(public readonly cutoffIsoDate: string) {
    super('PAYROLL_LOCKED');
    this.name = 'PayrollLockedError';
  }
}

/**
 * Imperative guard used by mutation endpoints across attendance / leave
 * / overtime. Throws `PayrollLockedError` when the mutation is refused;
 * service layers catch this and translate to a `ConflictException`.
 *
 * When guarding a **range** (leave requests span days), callers should
 * pass the `startDate` — the entire range is considered blocked if its
 * start falls inside the frozen period, since the range CANNOT lie
 * partially inside a frozen period without affecting payroll.
 */
export function assertPayrollNotLocked(
  targetDate: Date,
  payrollLockedUntil: Date | null | undefined,
  actor: CutoffActor,
): void {
  if (isMutationBlockedByPayrollLock(targetDate, payrollLockedUntil, actor)) {
    const iso = (payrollLockedUntil as Date).toISOString().slice(0, 10);
    throw new PayrollLockedError(iso);
  }
}
