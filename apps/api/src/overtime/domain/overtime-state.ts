/**
 * State machine for `OvertimeRequest`. Single-level approval — unlike Leave
 * where we have supervisor + HR gates. Overtime is fully decided by the
 * user's supervisor (or any HR/SUPER_ADMIN).
 *
 *   PENDING_APPROVAL ──approve──► APPROVED
 *   PENDING_APPROVAL ──reject───► REJECTED
 *   PENDING_APPROVAL ──cancel───► CANCELLED       (only owner, only while pending)
 *   APPROVED         ──complete─► COMPLETED       (out of MVP: cron after workDate)
 *
 * Any other event on any other state → IllegalTransitionError.
 * `approve` from a non-supervisor / non-HR actor → ForbiddenTransitionError.
 */

import type { OvertimeStatus } from '@prisma/client';

export type OvertimeEvent =
  | { kind: 'APPROVE'; actorRole: ActorRole; isTeamSupervisor: boolean }
  | { kind: 'REJECT'; actorRole: ActorRole; isTeamSupervisor: boolean }
  | { kind: 'CANCEL'; actorIsOwner: boolean }
  | { kind: 'COMPLETE' };

export type ActorRole = 'EMPLOYEE' | 'SUPERVISOR' | 'HR_MANAGER' | 'SUPER_ADMIN';

export class IllegalTransitionError extends Error {
  readonly code = 'ILLEGAL_TRANSITION';
  constructor(from: OvertimeStatus, event: OvertimeEvent['kind']) {
    super(`cannot ${event} an overtime request in state ${from}`);
    this.name = 'IllegalTransitionError';
  }
}

export class ForbiddenTransitionError extends Error {
  readonly code = 'FORBIDDEN';
  constructor(reason: string) {
    super(reason);
    this.name = 'ForbiddenTransitionError';
  }
}

export function transition(current: OvertimeStatus, event: OvertimeEvent): OvertimeStatus {
  switch (event.kind) {
    case 'APPROVE':
    case 'REJECT': {
      if (current !== 'PENDING_APPROVAL') {
        throw new IllegalTransitionError(current, event.kind);
      }
      // Employees can never approve/reject anyone (including themselves).
      // Supervisors can only decide for their own team; HR/SUPER_ADMIN can
      // decide anywhere in the tenant.
      if (event.actorRole === 'EMPLOYEE') {
        throw new ForbiddenTransitionError('only supervisor/HR can decide');
      }
      if (event.actorRole === 'SUPERVISOR' && !event.isTeamSupervisor) {
        throw new ForbiddenTransitionError('supervisor may only decide for their direct team');
      }
      return event.kind === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    }
    case 'CANCEL': {
      if (current !== 'PENDING_APPROVAL') {
        throw new IllegalTransitionError(current, event.kind);
      }
      if (!event.actorIsOwner) {
        throw new ForbiddenTransitionError('only the owner can cancel');
      }
      return 'CANCELLED';
    }
    case 'COMPLETE': {
      if (current !== 'APPROVED') {
        throw new IllegalTransitionError(current, event.kind);
      }
      return 'COMPLETED';
    }
  }
}
