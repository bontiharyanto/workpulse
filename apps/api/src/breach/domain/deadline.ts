import type { BreachStatus } from '@prisma/client';

import { isDeadlineActive } from './state-machine';

/**
 * Fase 31g — deadline math for regulator notification.
 *
 * UU 27/2022 Pelindungan Data Pribadi Pasal 46 ayat (3):
 *   "Pengendali Data Pribadi wajib memberitahukan pelanggaran
 *    pelindungan Data Pribadi paling lambat 3 x 24 (tiga kali dua
 *    puluh empat) jam kepada Subjek Data Pribadi dan Lembaga."
 *
 * GDPR Art. 33: 72 hours to supervisory authority. GDPR Art. 34:
 * without undue delay to data subjects when high risk.
 *
 * All math anchors on `detectedAt`. UTC everywhere; the FE presents
 * the countdown in the user's timezone.
 */

export const NOTIFICATION_DEADLINE_HOURS = 72;
export const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Returns the deadline instant (`detectedAt + 72h`) for authority
 * notification. Pure — no clock read; caller supplies `detectedAt`.
 */
export function deadlineFor(detectedAt: Date): Date {
  return new Date(detectedAt.getTime() + NOTIFICATION_DEADLINE_HOURS * MS_PER_HOUR);
}

export type DeadlineBucket = 'SAFE' | 'WARNING' | 'CRITICAL' | 'OVERDUE';

export interface DeadlineSnapshot {
  /** Number of hours (positive: remaining, negative: overdue). */
  hoursRemaining: number;
  bucket: DeadlineBucket;
  deadlineAt: Date;
  /** True once the 72h window has passed and the incident is still in
   *  a status where authority notification is outstanding. */
  overdue: boolean;
  /** Whether the countdown is still running for this incident. Stops
   *  once the incident has reached NOTIFIED_AUTHORITY or later. */
  active: boolean;
}

/**
 * Classifies a `hoursRemaining` value into UI-friendly buckets. The
 * thresholds match the reminder worker's fanout points so a user
 * whose incident shows CRITICAL in the UI knows a reminder has just
 * gone out.
 */
export function bucketFor(hoursRemaining: number): DeadlineBucket {
  if (hoursRemaining < 0) return 'OVERDUE';
  if (hoursRemaining <= 4) return 'CRITICAL';
  if (hoursRemaining <= 24) return 'WARNING';
  return 'SAFE';
}

/**
 * Pure snapshot at a given `now`. The service uses the process wall
 * clock; tests inject a fixed `now` for deterministic assertions.
 */
export function snapshot(
  detectedAt: Date,
  status: BreachStatus,
  now: Date = new Date(),
): DeadlineSnapshot {
  const deadlineAt = deadlineFor(detectedAt);
  const hoursRemaining = (deadlineAt.getTime() - now.getTime()) / MS_PER_HOUR;
  const active = isDeadlineActive(status);
  return {
    hoursRemaining,
    bucket: active ? bucketFor(hoursRemaining) : 'SAFE',
    deadlineAt,
    overdue: active && hoursRemaining < 0,
    active,
  };
}

/**
 * The four fanout points for the reminder worker. Each is expressed
 * as `hoursBeforeDeadline`; the worker fires at most once per bucket
 * per incident (deduped via `BreachTimelineEvent.eventType = DEADLINE_WARNED`
 * + `metadata.bucket`).
 *
 * OVERDUE is included so we get a paper trail even after the deadline
 * has passed — helpful for regulator conversations.
 */
export const DEADLINE_REMINDER_BUCKETS: ReadonlyArray<{
  bucket: DeadlineBucket;
  triggerAtHoursRemaining: number;
}> = [
  { bucket: 'WARNING', triggerAtHoursRemaining: 24 },
  { bucket: 'CRITICAL', triggerAtHoursRemaining: 4 },
  { bucket: 'OVERDUE', triggerAtHoursRemaining: 0 },
];
