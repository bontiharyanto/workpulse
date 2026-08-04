import type { TimesheetStatus, UserRole } from '@prisma/client';

/**
 * Fase 32g — pure validation for the "reopen APPROVED timesheet"
 * action. Kept independent of Prisma / Nest so every branch is
 * unit-testable against plain-object fixtures.
 *
 * A reopen is a *destructive* transition (it invalidates a paid
 * payroll row downstream), so the invariants live here in one place
 * rather than being scattered across the service.
 */

export const REOPEN_REASON_MIN = 10;
export const REOPEN_REASON_MAX = 500;

export type ReopenIssue =
  | 'FORBIDDEN_ROLE'
  | 'STATUS_NOT_APPROVED'
  | 'REASON_TOO_SHORT'
  | 'REASON_TOO_LONG'
  | 'REASON_MISSING';

export interface ReopenDecision {
  ok: boolean;
  issues: ReopenIssue[];
  /** Trimmed reason ready for persistence (only set when ok = true). */
  reason?: string;
}

export interface ReopenFacts {
  actorRole: UserRole;
  currentStatus: TimesheetStatus;
  reasonRaw: string | null | undefined;
}

/**
 * Validate a reopen request against the invariants:
 *
 * - Only `HR_MANAGER` and `SUPER_ADMIN` may reopen. Supervisors
 *   cannot unilaterally undo an HR-final decision, and employees
 *   should never be able to bypass approval by "reopening" their
 *   own record.
 * - The row MUST currently be `APPROVED`. Reopening a `DRAFT` /
 *   `PENDING_*` / `REJECTED` row makes no semantic sense — those
 *   rows are already in the workflow.
 * - `reason` is mandatory and MUST be 10..500 characters after
 *   trimming. The floor is high enough to refuse "salah" / "typo"
 *   but low enough that a busy HR can still record "OT rate revised
 *   post-payroll" without a template.
 */
export function validateReopen(facts: ReopenFacts): ReopenDecision {
  const issues: ReopenIssue[] = [];

  if (facts.actorRole !== 'HR_MANAGER' && facts.actorRole !== 'SUPER_ADMIN') {
    issues.push('FORBIDDEN_ROLE');
  }

  if (facts.currentStatus !== 'APPROVED') {
    issues.push('STATUS_NOT_APPROVED');
  }

  const trimmed = (facts.reasonRaw ?? '').trim();
  if (trimmed.length === 0) {
    issues.push('REASON_MISSING');
  } else if (trimmed.length < REOPEN_REASON_MIN) {
    issues.push('REASON_TOO_SHORT');
  } else if (trimmed.length > REOPEN_REASON_MAX) {
    issues.push('REASON_TOO_LONG');
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, issues: [], reason: trimmed };
}
