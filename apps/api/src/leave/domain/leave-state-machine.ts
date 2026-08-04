import type { LeaveStatus } from '@prisma/client';

import type { UserRole } from '../../common/types/user-role';

export type LeaveEvent =
  | { kind: 'SUBMIT' }
  | { kind: 'APPROVE'; actorRole: UserRole }
  | { kind: 'REJECT'; actorRole: UserRole }
  | { kind: 'CANCEL' };

export interface Transition {
  next: LeaveStatus;
  /** How much of the reserved pool moves. Positive = release, negative = additional hold. */
  reservedDelta: number;
  /** How much of the used pool changes. */
  usedDelta: number;
}

const APPROVER_LEVEL_1: readonly UserRole[] = ['SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN'];
const APPROVER_LEVEL_2: readonly UserRole[] = ['HR_MANAGER', 'SUPER_ADMIN'];

/**
 * Given the current status and an event, return the intended next status and
 * balance mutation. Throws a stable `ILLEGAL_TRANSITION` if the event is not
 * valid from the current state (or the actor lacks the required role).
 *
 * Pure — no I/O, no Prisma. Consumers wrap the result in a $transaction.
 */
export function transition(current: LeaveStatus, event: LeaveEvent): Transition {
  switch (current) {
    case 'DRAFT':
    case 'PENDING_SUPERVISOR':
      if (event.kind === 'SUBMIT' && current === 'DRAFT') {
        return { next: 'PENDING_SUPERVISOR', reservedDelta: 0, usedDelta: 0 };
      }
      if (event.kind === 'APPROVE') {
        assertRole(event.actorRole, APPROVER_LEVEL_1);
        // Supervisor / HR level-1 approval → advance, no balance change yet.
        return { next: 'PENDING_HR', reservedDelta: 0, usedDelta: 0 };
      }
      if (event.kind === 'REJECT') {
        assertRole(event.actorRole, APPROVER_LEVEL_1);
        return { next: 'REJECTED', reservedDelta: -1, usedDelta: 0 };
      }
      if (event.kind === 'CANCEL') {
        return { next: 'CANCELLED', reservedDelta: -1, usedDelta: 0 };
      }
      break;

    case 'PENDING_HR':
      if (event.kind === 'APPROVE') {
        assertRole(event.actorRole, APPROVER_LEVEL_2);
        return { next: 'APPROVED', reservedDelta: -1, usedDelta: +1 };
      }
      if (event.kind === 'REJECT') {
        assertRole(event.actorRole, APPROVER_LEVEL_2);
        return { next: 'REJECTED', reservedDelta: -1, usedDelta: 0 };
      }
      if (event.kind === 'CANCEL') {
        return { next: 'CANCELLED', reservedDelta: -1, usedDelta: 0 };
      }
      break;

    case 'APPROVED':
    case 'REJECTED':
    case 'CANCELLED':
      // Terminal — no transitions allowed.
      break;
  }

  throw new IllegalTransitionError(current, event);
}

function assertRole(actor: UserRole, allowed: readonly UserRole[]): void {
  if (!allowed.includes(actor)) {
    throw new ForbiddenTransitionError(actor);
  }
}

export class IllegalTransitionError extends Error {
  readonly code = 'ILLEGAL_TRANSITION' as const;
  constructor(current: LeaveStatus, event: LeaveEvent) {
    super(`Cannot ${event.kind} from ${current}`);
    this.name = 'IllegalTransitionError';
  }
}

export class ForbiddenTransitionError extends Error {
  readonly code = 'FORBIDDEN' as const;
  constructor(actor: UserRole) {
    super(`Role ${actor} not allowed`);
    this.name = 'ForbiddenTransitionError';
  }
}
