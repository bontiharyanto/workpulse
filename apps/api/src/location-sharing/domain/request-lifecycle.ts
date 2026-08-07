import type { LocationShareRequestStatus } from '@prisma/client';

/**
 * ADR-0041 §Lifecycle. Pure — no DB, no clock.
 *
 * A request lives through exactly one of these paths:
 *
 *   PENDING ─┬─▶ RESPONDED   (user accepted with coord)
 *            ├─▶ DECLINED    (user answered "no")
 *            ├─▶ EXPIRED     (retention cron flipped it past TTL)
 *            └─▶ CANCELLED   (supervisor withdrew)
 *
 * The four terminal states are semantically distinct because HR
 * and audit read them differently:
 *
 *   - RESPONDED / DECLINED are USER actions — the answer is theirs.
 *   - EXPIRED is a SYSTEM action — no consent decision was made.
 *   - CANCELLED is a SUPERVISOR action — no user was ever obliged
 *     to respond.
 *
 * Collapsing any of these into a shared "closed" state would erase
 * information the DPIA cares about.
 */

/**
 * TTL for a fresh request, in milliseconds. 15 minutes matches
 * ADR-0041 open-question resolution — see the ADR for rationale.
 */
export const LOCATION_SHARE_REQUEST_TTL_MS = 15 * 60 * 1000;

/**
 * Rate-limit ceiling — one target user cannot receive more than this
 * many `PENDING` OR `RESPONDED` requests within a rolling 24h window
 * across the entire tenant. Protects against a supervisor abusing
 * the feature into a notification-DDoS.
 *
 * DECLINED / EXPIRED / CANCELLED do NOT count — a user who declines
 * shouldn't be locked out from receiving legitimate future asks just
 * because someone spammed them. Same story for EXPIRED (user was
 * offline, not opted-out) and CANCELLED (supervisor withdrew).
 */
export const LOCATION_SHARE_DAILY_QUOTA_PER_USER = 6;

export function computeExpiresAt(now: Date): Date {
  return new Date(now.getTime() + LOCATION_SHARE_REQUEST_TTL_MS);
}

export function isTerminal(status: LocationShareRequestStatus): boolean {
  return status !== 'PENDING';
}

/**
 * Which transitions the service will permit. Called before any DB
 * write so a bogus transition fails fast with a clear error code
 * instead of a Prisma constraint violation.
 */
export function canTransition(
  from: LocationShareRequestStatus,
  to: LocationShareRequestStatus,
): boolean {
  if (from !== 'PENDING') return false;
  return to === 'RESPONDED' || to === 'DECLINED' || to === 'EXPIRED' || to === 'CANCELLED';
}

/**
 * Retention thresholds for the purge worker. Values pulled directly
 * from ADR-0041 — do NOT tune per-tenant without a new ADR.
 */
export const LOCATION_PING_RETENTION_DAYS = 7;
export const LOCATION_SHARE_REQUEST_RETENTION_DAYS = 90;
