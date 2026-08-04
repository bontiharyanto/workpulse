/**
 * Attendance Correction state machine.
 *
 * Single-level approval:
 *
 *   PENDING_APPROVAL ──approve──► APPROVED
 *   PENDING_APPROVAL ──reject───► REJECTED
 *   PENDING_APPROVAL ──cancel───► CANCELLED   (owner only)
 *
 * Terminal states never transition. Kept pure so the same rules apply in
 * unit tests and in `AttendanceCorrectionService.decide` / `.cancel`.
 *
 * Contrast with Leave (two-level supervisor→HR gate): a punch correction
 * is bounded in blast radius (patches one AttendanceRecord for one day)
 * and a supervisor already knows whether the report was in that day —
 * a second HR gate would add drag without adding information.
 */

import type { AttendanceCorrectionStatus } from '@prisma/client';

export type CorrectionActorRole =
  | 'EMPLOYEE'
  | 'SUPERVISOR'
  | 'HR_MANAGER'
  | 'SUPER_ADMIN';

export type CorrectionEvent =
  | {
      kind: 'APPROVE' | 'REJECT';
      actorRole: CorrectionActorRole;
      /** True when the actor is `request.user.supervisorId`. */
      isTeamSupervisor: boolean;
    }
  | { kind: 'CANCEL'; actorIsOwner: boolean };

export class IllegalCorrectionTransitionError extends Error {
  readonly code = 'ILLEGAL_TRANSITION' as const;
  constructor(from: AttendanceCorrectionStatus, event: CorrectionEvent['kind']) {
    super(`cannot ${event} an attendance correction in state ${from}`);
    this.name = 'IllegalCorrectionTransitionError';
  }
}

export class ForbiddenCorrectionTransitionError extends Error {
  readonly code = 'FORBIDDEN' as const;
  constructor(reason: string) {
    super(reason);
    this.name = 'ForbiddenCorrectionTransitionError';
  }
}

export function transition(
  current: AttendanceCorrectionStatus,
  event: CorrectionEvent,
): AttendanceCorrectionStatus {
  switch (event.kind) {
    case 'APPROVE':
    case 'REJECT': {
      if (current !== 'PENDING_APPROVAL') {
        throw new IllegalCorrectionTransitionError(current, event.kind);
      }
      if (event.actorRole === 'EMPLOYEE') {
        throw new ForbiddenCorrectionTransitionError(
          'employees cannot decide corrections',
        );
      }
      if (event.actorRole === 'SUPERVISOR' && !event.isTeamSupervisor) {
        throw new ForbiddenCorrectionTransitionError(
          'supervisor may only decide corrections for their direct team',
        );
      }
      return event.kind === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    }
    case 'CANCEL': {
      if (current !== 'PENDING_APPROVAL') {
        throw new IllegalCorrectionTransitionError(current, event.kind);
      }
      if (!event.actorIsOwner) {
        throw new ForbiddenCorrectionTransitionError(
          'only the owner may cancel a correction',
        );
      }
      return 'CANCELLED';
    }
  }
}
