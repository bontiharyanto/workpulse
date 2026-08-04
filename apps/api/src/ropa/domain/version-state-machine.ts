import type { RopaVersionStatus } from '@prisma/client';

/**
 * Fase 31d — pure state machine for a `RopaActivityVersion`.
 *
 * Kept isolated from Prisma / Nest so every legal + illegal transition is
 * unit-testable against plain object fixtures. The DB schema does NOT
 * enforce these rules (no CHECK constraint tying `status` to
 * `publishedAt`) — the machine is the single source of truth.
 *
 * Legal transitions:
 *
 *   [create]  → DRAFT
 *   DRAFT     ⇄ REVIEW      (submit-review / return-to-draft)
 *   REVIEW    → PUBLISHED   (publish; simultaneously archives previous published)
 *   PUBLISHED → ARCHIVED    (implicit when new version publishes; also
 *                            allowed explicitly to withdraw a mistake — the
 *                            activity then has NO current published version)
 *
 * Illegal: any edit against a non-DRAFT row; any publish from DRAFT
 * (must go through REVIEW so the two-step gate cannot be bypassed).
 */

export type RopaTransition = 'SUBMIT_REVIEW' | 'RETURN_TO_DRAFT' | 'PUBLISH' | 'ARCHIVE';

export class IllegalRopaTransitionError extends Error {
  readonly code = 'ROPA_ILLEGAL_TRANSITION' as const;
  constructor(
    readonly from: RopaVersionStatus,
    readonly attempted: RopaTransition,
  ) {
    super(`Cannot ${attempted} from ${from}`);
  }
}

/**
 * Return the target status for the requested transition, or throw
 * `IllegalRopaTransitionError`. Callers map the error to a `409 Conflict`
 * with the `code` embedded so the FE can display a localised message.
 */
export function transition(from: RopaVersionStatus, action: RopaTransition): RopaVersionStatus {
  switch (action) {
    case 'SUBMIT_REVIEW':
      if (from === 'DRAFT') return 'REVIEW';
      break;
    case 'RETURN_TO_DRAFT':
      if (from === 'REVIEW') return 'DRAFT';
      break;
    case 'PUBLISH':
      if (from === 'REVIEW') return 'PUBLISHED';
      break;
    case 'ARCHIVE':
      // Archive is legal from PUBLISHED (withdrawal) and also idempotent
      // from ARCHIVED (worker retries, concurrent publishes). It is NOT
      // legal to archive a DRAFT / REVIEW row — those are cheap to delete.
      if (from === 'PUBLISHED' || from === 'ARCHIVED') return 'ARCHIVED';
      break;
    default: {
      const exhaustive: never = action;
      throw new Error(`unknown ropa transition: ${String(exhaustive)}`);
    }
  }
  throw new IllegalRopaTransitionError(from, action);
}

/**
 * Guard: can this status still be edited? DRAFT rows accept `PATCH`
 * from the service; every other status is frozen. Callers that ignore
 * this guard would produce inconsistent regulator exports (a row could
 * silently drift between REVIEW and PUBLISHED reads).
 */
export function isEditable(status: RopaVersionStatus): boolean {
  return status === 'DRAFT';
}

/**
 * Guard: does this status count as the current published record for the
 * activity? Regulator exports and the public-facing `currentVersion`
 * pointer key off this predicate.
 */
export function isCurrent(status: RopaVersionStatus): boolean {
  return status === 'PUBLISHED';
}
