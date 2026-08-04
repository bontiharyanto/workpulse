import { TimesheetStatus } from '@prisma/client';

import type { UserRole } from '../../common/types/user-role';

export type WorkflowAction =
  | { kind: 'SUBMIT'; actorIsOwner: boolean }
  | {
      kind: 'SUPERVISOR_APPROVE';
      actorRole: UserRole;
      isTeamSupervisor: boolean;
    }
  | {
      kind: 'SUPERVISOR_REJECT';
      actorRole: UserRole;
      isTeamSupervisor: boolean;
    }
  | { kind: 'HR_APPROVE'; actorRole: UserRole }
  | { kind: 'HR_REJECT'; actorRole: UserRole };

export class IllegalTimesheetTransitionError extends Error {
  readonly code = 'TIMESHEET_ILLEGAL_TRANSITION';
  constructor(readonly from: TimesheetStatus, readonly to: string) {
    super(`illegal timesheet transition ${from} → ${to}`);
  }
}

export class ForbiddenTimesheetTransitionError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/**
 * Pure state machine for the timesheet review workflow (Fase 32b).
 *
 * Transition matrix:
 *
 *   DRAFT              → SUBMIT             → PENDING_SUPERVISOR
 *   PENDING_SUPERVISOR → SUPERVISOR_APPROVE → PENDING_HR
 *   PENDING_SUPERVISOR → SUPERVISOR_REJECT  → REJECTED
 *   PENDING_HR         → HR_APPROVE         → APPROVED
 *   PENDING_HR         → HR_REJECT          → REJECTED
 *   REJECTED           → SUBMIT             → PENDING_SUPERVISOR   (re-submit path)
 *
 * Every other combination is either an illegal transition (409) or a
 * forbidden actor (403), depending on the failure mode:
 *
 * - Illegal transition (409): the row is not in a state where this
 *   action makes sense at all — e.g. approving a DRAFT or submitting
 *   an APPROVED row.
 * - Forbidden actor (403): the row is in a legal state for the action,
 *   but the caller is not authorised to run it — e.g. a peer employee
 *   trying to approve someone else's timesheet.
 *
 * `APPROVED` is terminal — the payroll-lock semantics kick in from
 * here (Fase 32a's `payrollLockedUntil` interaction, honoured via the
 * regenerate guard in `TimesheetService`).
 */
export function transition(
  from: TimesheetStatus,
  action: WorkflowAction,
): TimesheetStatus {
  switch (action.kind) {
    case 'SUBMIT':
      return handleSubmit(from, action);
    case 'SUPERVISOR_APPROVE':
      return handleSupervisorApprove(from, action);
    case 'SUPERVISOR_REJECT':
      return handleSupervisorReject(from, action);
    case 'HR_APPROVE':
      return handleHrApprove(from, action);
    case 'HR_REJECT':
      return handleHrReject(from, action);
    default: {
      const exhaustive: never = action;
      throw new Error(`unhandled action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function handleSubmit(
  from: TimesheetStatus,
  action: Extract<WorkflowAction, { kind: 'SUBMIT' }>,
): TimesheetStatus {
  if (!action.actorIsOwner) {
    // Only the owner can submit their own timesheet. HR "on behalf of"
    // is out of scope for 32b — HR unblocks by regenerating a DRAFT.
    throw new ForbiddenTimesheetTransitionError('TIMESHEET_FORBIDDEN_OWNER');
  }
  if (from === TimesheetStatus.DRAFT || from === TimesheetStatus.REJECTED) {
    return TimesheetStatus.PENDING_SUPERVISOR;
  }
  throw new IllegalTimesheetTransitionError(from, 'SUBMIT');
}

function handleSupervisorApprove(
  from: TimesheetStatus,
  action: Extract<WorkflowAction, { kind: 'SUPERVISOR_APPROVE' }>,
): TimesheetStatus {
  if (from !== TimesheetStatus.PENDING_SUPERVISOR) {
    throw new IllegalTimesheetTransitionError(from, 'SUPERVISOR_APPROVE');
  }
  assertSupervisorOrElevated(action.actorRole, action.isTeamSupervisor);
  return TimesheetStatus.PENDING_HR;
}

function handleSupervisorReject(
  from: TimesheetStatus,
  action: Extract<WorkflowAction, { kind: 'SUPERVISOR_REJECT' }>,
): TimesheetStatus {
  if (from !== TimesheetStatus.PENDING_SUPERVISOR) {
    throw new IllegalTimesheetTransitionError(from, 'SUPERVISOR_REJECT');
  }
  assertSupervisorOrElevated(action.actorRole, action.isTeamSupervisor);
  return TimesheetStatus.REJECTED;
}

function handleHrApprove(
  from: TimesheetStatus,
  action: Extract<WorkflowAction, { kind: 'HR_APPROVE' }>,
): TimesheetStatus {
  if (from !== TimesheetStatus.PENDING_HR) {
    throw new IllegalTimesheetTransitionError(from, 'HR_APPROVE');
  }
  assertHrOrElevated(action.actorRole);
  return TimesheetStatus.APPROVED;
}

function handleHrReject(
  from: TimesheetStatus,
  action: Extract<WorkflowAction, { kind: 'HR_REJECT' }>,
): TimesheetStatus {
  if (from !== TimesheetStatus.PENDING_HR) {
    throw new IllegalTimesheetTransitionError(from, 'HR_REJECT');
  }
  assertHrOrElevated(action.actorRole);
  return TimesheetStatus.REJECTED;
}

function assertSupervisorOrElevated(
  role: UserRole,
  isTeamSupervisor: boolean,
): void {
  if (role === 'HR_MANAGER' || role === 'SUPER_ADMIN') return;
  if (role === 'SUPERVISOR' && isTeamSupervisor) return;
  throw new ForbiddenTimesheetTransitionError(
    'TIMESHEET_FORBIDDEN_SUPERVISOR',
  );
}

function assertHrOrElevated(role: UserRole): void {
  if (role === 'HR_MANAGER' || role === 'SUPER_ADMIN') return;
  throw new ForbiddenTimesheetTransitionError('TIMESHEET_FORBIDDEN_HR');
}

/**
 * Convenience for the regenerate guard: `true` when the timesheet is
 * locked to source-row edits (APPROVED). Every other state — including
 * PENDING_HR — permits regenerate because the auto-generator is the
 * only source of truth up until HR seals the row.
 */
export function isRegenerateLocked(status: TimesheetStatus): boolean {
  return status === TimesheetStatus.APPROVED;
}
