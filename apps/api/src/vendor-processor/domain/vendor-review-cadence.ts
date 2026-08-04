/**
 * Fase 31f — Pure functions for the Vendor / Processor Register.
 *
 * Two orthogonal concerns live here:
 *
 *   1. Review cadence — computing when the next review must happen
 *      and which reminders should fire *today* (T-30d / T-60d).
 *   2. Status transitions — enforcing the allowed state-machine
 *      moves so an admin cannot e.g. flip a `TERMINATED` vendor
 *      back to `ACTIVE` behind the DPO's back.
 *
 * Both are pure: they never touch the DB, never read `new Date()`
 * on their own — the caller passes `now` explicitly so the whole
 * thing is trivially testable and reproducible.
 */

import type { VendorStatus } from '@prisma/client';

// --- Cadence knobs (env-tunable in the worker, kept as domain
// constants here so unit tests stay hermetic) ---------------------

/** Vendors must be re-reviewed at least once a year. */
export const DEFAULT_REVIEW_INTERVAL_DAYS = 365;

/** Fire the "review due" reminder this many days before nextReviewAt. */
export const REVIEW_REMINDER_LEAD_DAYS = 30;

/**
 * Fire the "contract expiring" reminder this many days before
 * contractEndAt. 60d chosen because Indonesian corporate procurement
 * cycles typically need at least 45 days from renewal decision to
 * new PO issuance.
 */
export const CONTRACT_EXPIRY_LEAD_DAYS = 60;

// --- Cadence math -------------------------------------------------

const MS_PER_DAY = 86_400_000;

/** Days between two dates, ignoring wall-clock time-of-day. Result
 *  can be negative if `target` is in the past. */
export function daysUntil(now: Date, target: Date): number {
  const truncatedNow = Math.floor(now.getTime() / MS_PER_DAY);
  const truncatedTarget = Math.floor(target.getTime() / MS_PER_DAY);
  return truncatedTarget - truncatedNow;
}

/** Add N days to a date without mutating the input. */
export function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * MS_PER_DAY);
}

/**
 * Compute the default `nextReviewAt` for a freshly created vendor.
 * Uses `contractStartAt` when supplied so a vendor whose contract
 * kicks in mid-year still gets reviewed one full year later, not
 * one year from the admin's create-click.
 */
export function computeInitialNextReviewAt(now: Date, contractStartAt: Date | null): Date {
  const anchor = contractStartAt ?? now;
  return addDays(anchor, DEFAULT_REVIEW_INTERVAL_DAYS);
}

// --- Reminder decision -------------------------------------------

export type ReminderKind = 'REVIEW_DUE' | 'CONTRACT_EXPIRING';

export interface VendorReminderInput {
  status: VendorStatus;
  nextReviewAt: Date;
  contractEndAt: Date | null;
}

export interface VendorReminderDecision {
  kind: ReminderKind;
  /** The stored `nextReviewAt` / `contractEndAt` — used as the dedup
   *  key so a rescheduled cycle triggers a fresh reminder. */
  expectedFor: Date;
  /** Days until the cutoff. Negative means overdue. */
  daysUntil: number;
  severity: 'info' | 'warning' | 'critical';
}

/**
 * Decide which reminders should fire for a single vendor right now.
 *
 *   - `TERMINATED` and `DEPRECATED` vendors never trigger reminders
 *     (nothing to review, nothing to renew).
 *   - `REVIEW_DUE` fires when `nextReviewAt` is within 30 days OR
 *     already past. Severity crosses to `critical` once overdue.
 *   - `CONTRACT_EXPIRING` fires when `contractEndAt` is within 60
 *     days OR already past. Severity `critical` once overdue since
 *     an expired contract with an `ACTIVE` vendor is a compliance
 *     defect that legal will want to know about immediately.
 */
export function computeDueReminders(
  now: Date,
  input: VendorReminderInput,
): VendorReminderDecision[] {
  const out: VendorReminderDecision[] = [];
  if (input.status === 'TERMINATED' || input.status === 'DEPRECATED') {
    return out;
  }

  const reviewDelta = daysUntil(now, input.nextReviewAt);
  if (reviewDelta <= REVIEW_REMINDER_LEAD_DAYS) {
    out.push({
      kind: 'REVIEW_DUE',
      expectedFor: input.nextReviewAt,
      daysUntil: reviewDelta,
      severity: reviewDelta < 0 ? 'critical' : 'warning',
    });
  }

  if (input.contractEndAt) {
    const contractDelta = daysUntil(now, input.contractEndAt);
    if (contractDelta <= CONTRACT_EXPIRY_LEAD_DAYS) {
      out.push({
        kind: 'CONTRACT_EXPIRING',
        expectedFor: input.contractEndAt,
        daysUntil: contractDelta,
        severity: contractDelta < 0 ? 'critical' : 'warning',
      });
    }
  }

  return out;
}

// --- Status state machine ----------------------------------------

/**
 * Allowed vendor status transitions. Anything not in this map is
 * a hard `ConflictException` at the service layer.
 *
 *   UNDER_REVIEW -> ACTIVE          (DPA signed, vendor cleared)
 *   UNDER_REVIEW -> TERMINATED      (walked away during negotiation)
 *   ACTIVE       -> DEPRECATED      (winding down but still live)
 *   ACTIVE       -> TERMINATED      (contract ended cleanly)
 *   DEPRECATED   -> TERMINATED      (migration complete)
 *   DEPRECATED   -> ACTIVE          (deprecation reversed — rare
 *                                    but useful when a "sunset" is
 *                                    called off; requires explicit
 *                                    override at the UI layer).
 *
 * TERMINATED is a terminal state — no exits allowed. A brand-new
 * DPA with the same vendor must create a fresh row so the
 * historical record survives untouched.
 */
export const ALLOWED_STATUS_TRANSITIONS: Readonly<
  Record<VendorStatus, ReadonlyArray<VendorStatus>>
> = {
  UNDER_REVIEW: ['ACTIVE', 'TERMINATED'],
  ACTIVE: ['DEPRECATED', 'TERMINATED'],
  DEPRECATED: ['ACTIVE', 'TERMINATED'],
  TERMINATED: [],
};

export function canTransition(from: VendorStatus, to: VendorStatus): boolean {
  if (from === to) return true;
  return ALLOWED_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * ACTIVE is only allowed when the DPA has been countersigned.
 * Keeps a lax admin from marking a vendor live before legal is done.
 */
export function canBeActive(dpaSignedAt: Date | null): boolean {
  return dpaSignedAt !== null;
}
