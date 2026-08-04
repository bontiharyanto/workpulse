import { DpiaStatus } from '@prisma/client';

/**
 * Fase 31e — DPIA lifecycle state machine.
 *
 * Legal transitions:
 *
 *   DRAFT → REVIEW       submit-for-review
 *   REVIEW → DRAFT       return-to-draft (reviewer sends back for edits)
 *   REVIEW → APPROVED    approve (DPO signs off)
 *   APPROVED → ARCHIVED  archive (superseded by a newer APPROVED)
 *
 * Anything else is illegal and callers get `IllegalDpiaTransitionError`.
 * Publish-from-DRAFT is deliberately refused so the two-step gate cannot
 * be bypassed (matches the ROPA workflow shipped in ADR-0030).
 */

export type DpiaTransition = 'SUBMIT_REVIEW' | 'RETURN_TO_DRAFT' | 'APPROVE' | 'ARCHIVE';

const LEGAL: ReadonlyArray<readonly [DpiaStatus, DpiaTransition, DpiaStatus]> = [
  [DpiaStatus.DRAFT, 'SUBMIT_REVIEW', DpiaStatus.REVIEW],
  [DpiaStatus.REVIEW, 'RETURN_TO_DRAFT', DpiaStatus.DRAFT],
  [DpiaStatus.REVIEW, 'APPROVE', DpiaStatus.APPROVED],
  [DpiaStatus.APPROVED, 'ARCHIVE', DpiaStatus.ARCHIVED],
];

export class IllegalDpiaTransitionError extends Error {
  constructor(from: DpiaStatus, action: DpiaTransition) {
    super(`Cannot ${action} a DPIA that is currently ${from}`);
    this.name = 'IllegalDpiaTransitionError';
  }
}

export function transition(from: DpiaStatus, action: DpiaTransition): DpiaStatus {
  for (const [f, a, to] of LEGAL) {
    if (f === from && a === action) return to;
  }
  throw new IllegalDpiaTransitionError(from, action);
}

/** Only DRAFT DPIAs may be edited (title, scope, risk items…). */
export function isEditable(status: DpiaStatus): boolean {
  return status === DpiaStatus.DRAFT;
}

/** The regulator-facing "current" DPIA for an activity. */
export function isCurrent(status: DpiaStatus): boolean {
  return status === DpiaStatus.APPROVED;
}
