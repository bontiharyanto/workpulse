/**
 * Fase 32e — fixed retry schedule for outbound webhooks.
 *
 * Design choice (see ADR-0027): a deterministic schedule beats
 * exponential-with-jitter for our workload. Payroll integrations are
 * low-volume and operators want a predictable "if it hasn't succeeded
 * in ~6.5 hours it never will". The four slots also line up nicely
 * with human-timescale escalation (30s → same-shift; 5m → grab
 * coffee; 30m → checked between meetings; 6h → next business day).
 *
 * Slot 0 is the initial dispatch (delay from enqueue). Slots 1..N are
 * the retries. `WEBHOOK_MAX_ATTEMPTS` bounds how many attempts we run
 * total — 4 attempts = initial + 3 retries by default.
 */

export const RETRY_SCHEDULE_MS: readonly number[] = [
  0, //         attempt 1 — dispatch immediately
  30_000, //    attempt 2 — after 30s
  5 * 60_000, // attempt 3 — after 5m
  30 * 60_000, // attempt 4 — after 30m
  6 * 3600_000, // attempt 5 — after 6h (only reached if MAX_ATTEMPTS > 4)
];

/**
 * Compute the next `attemptCount` and `nextAttemptAt` after a failure.
 *
 * Returns `null` when retries are exhausted — the caller marks the row
 * `FAILED` in that case.
 *
 * `previousAttemptCount` is the count BEFORE we tried; it becomes
 * `previousAttemptCount + 1` in the outbound row regardless of
 * success/failure. `maxAttempts` is the terminal threshold.
 */
export interface RetryPlan {
  attemptCount: number;
  nextAttemptAt: Date;
}

export function planNextAttempt(
  previousAttemptCount: number,
  maxAttempts: number,
  now: number = Date.now(),
): RetryPlan | null {
  const nextCount = previousAttemptCount + 1;
  if (nextCount >= maxAttempts) return null;
  const slot = Math.min(nextCount, RETRY_SCHEDULE_MS.length - 1);
  const delay = RETRY_SCHEDULE_MS[slot] ?? 0;
  return {
    attemptCount: nextCount,
    nextAttemptAt: new Date(now + delay),
  };
}
