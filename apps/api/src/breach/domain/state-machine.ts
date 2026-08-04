import { BreachStatus } from '@prisma/client';

/**
 * Fase 31g — BreachIncident lifecycle state machine.
 *
 * Forward-only. Legal transitions:
 *
 *   DETECTED           → CONTAINED
 *   DETECTED           → NOTIFIED_AUTHORITY   (fast-track when authority
 *                                              must be notified before
 *                                              full containment is
 *                                              possible — UU PDP § 46
 *                                              still runs the 72h clock)
 *   CONTAINED          → NOTIFIED_AUTHORITY
 *   NOTIFIED_AUTHORITY → NOTIFIED_SUBJECTS
 *   NOTIFIED_SUBJECTS  → CLOSED
 *   *                  → CLOSED               (allowed only when severity
 *                                              is LOW and evidence shows
 *                                              no data subject risk —
 *                                              service layer performs the
 *                                              secondary check; the raw
 *                                              transition is legal here)
 *
 * Backward transitions are forbidden — historical status is a legal
 * exhibit. Corrective action is expressed via a compensating
 * `NOTE_ADDED` timeline event, never by rewinding `status`.
 */

export type BreachTransition =
  | 'MARK_CONTAINED'
  | 'MARK_AUTHORITY_NOTIFIED'
  | 'MARK_SUBJECTS_NOTIFIED'
  | 'CLOSE';

const LEGAL: ReadonlyArray<
  readonly [BreachStatus, BreachTransition, BreachStatus]
> = [
  [BreachStatus.DETECTED, 'MARK_CONTAINED', BreachStatus.CONTAINED],
  [
    BreachStatus.DETECTED,
    'MARK_AUTHORITY_NOTIFIED',
    BreachStatus.NOTIFIED_AUTHORITY,
  ],
  [
    BreachStatus.CONTAINED,
    'MARK_AUTHORITY_NOTIFIED',
    BreachStatus.NOTIFIED_AUTHORITY,
  ],
  [
    BreachStatus.NOTIFIED_AUTHORITY,
    'MARK_SUBJECTS_NOTIFIED',
    BreachStatus.NOTIFIED_SUBJECTS,
  ],
  [BreachStatus.NOTIFIED_SUBJECTS, 'CLOSE', BreachStatus.CLOSED],
  // Escape hatch for verified low-risk incidents where no notification
  // is legally required. Service layer double-checks severity.
  [BreachStatus.DETECTED, 'CLOSE', BreachStatus.CLOSED],
  [BreachStatus.CONTAINED, 'CLOSE', BreachStatus.CLOSED],
  [BreachStatus.NOTIFIED_AUTHORITY, 'CLOSE', BreachStatus.CLOSED],
];

export class IllegalBreachTransitionError extends Error {
  constructor(from: BreachStatus, action: BreachTransition) {
    super(`Cannot ${action} a breach that is currently ${from}`);
    this.name = 'IllegalBreachTransitionError';
  }
}

/**
 * Applies a transition and returns the new status. Throws
 * `IllegalBreachTransitionError` when the source/action combination is
 * not in the legal table above.
 */
export function transition(
  from: BreachStatus,
  action: BreachTransition,
): BreachStatus {
  for (const [f, a, to] of LEGAL) {
    if (f === from && a === action) return to;
  }
  throw new IllegalBreachTransitionError(from, action);
}

/**
 * CLOSED is terminal — the service should refuse further edits after
 * this point. UI can still surface the incident, but it becomes
 * read-only.
 */
export function isTerminal(status: BreachStatus): boolean {
  return status === BreachStatus.CLOSED;
}

/**
 * Whether a given status represents a state where the 72-hour clock
 * against `detectedAt` still runs. Once authority-notified, the
 * regulator deadline is met and the countdown stops.
 */
export function isDeadlineActive(status: BreachStatus): boolean {
  return (
    status === BreachStatus.DETECTED || status === BreachStatus.CONTAINED
  );
}
