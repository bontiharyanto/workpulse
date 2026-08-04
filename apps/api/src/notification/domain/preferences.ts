import type { NotificationType } from '@prisma/client';

/**
 * Preference resolution for the fanout hot path.
 *
 * ## Design
 *
 * - Preferences are stored as OVERRIDES only. Absence of a row for
 *   `(user, type)` implies both channels are on. That's the safer
 *   default for a workforce app: a new hire who hasn't touched their
 *   preferences should still receive their leave approvals.
 * - `mandatoryNotificationTypes` names types that IGNORE the user's
 *   opt-out entirely. These are typically security-critical
 *   (`PASSWORD_RESET`) — silently swallowing them would break the
 *   security model. The list is intentionally short.
 * - The helper is a PURE function so unit tests can exercise the
 *   truth table without touching Prisma or Nest DI.
 */

/**
 * Notification types the user cannot opt out of. Editing this list is
 * a policy decision — flag it explicitly in the PR description and
 * bump `docs/ADR/ADR-0012` if the security posture changes.
 */
export const mandatoryNotificationTypes: ReadonlySet<NotificationType> =
  new Set<NotificationType>([
    // Password reset confirmation carries the "someone reset your
    // password" signal — opting out would let an attacker who breached
    // a session silently disable this notification. Non-negotiable.
    'PASSWORD_RESET',
  ]);

export interface EffectivePreference {
  emailEnabled: boolean;
  inAppEnabled: boolean;
}

export interface PreferenceRow {
  type: NotificationType;
  emailEnabled: boolean;
  inAppEnabled: boolean;
}

/**
 * Compute the effective delivery preference for a given user/type
 * pair, given the (optional) row in the DB.
 *
 * @param type The notification type being delivered.
 * @param row The stored preference row (`null`/`undefined` = defaults).
 * @returns `{ emailEnabled, inAppEnabled }`.
 *
 * Semantics:
 *
 *   - No row → both channels on (default subscribe).
 *   - Mandatory type → both channels FORCED on, regardless of row.
 *     This is the security bypass: `PASSWORD_RESET` will always
 *     deliver even if the user has an opt-out row on file.
 *   - Otherwise → row values apply verbatim.
 */
export function resolveEffective(
  type: NotificationType,
  row: PreferenceRow | null | undefined,
): EffectivePreference {
  if (mandatoryNotificationTypes.has(type)) {
    return { emailEnabled: true, inAppEnabled: true };
  }
  if (!row) {
    return { emailEnabled: true, inAppEnabled: true };
  }
  return {
    emailEnabled: row.emailEnabled,
    inAppEnabled: row.inAppEnabled,
  };
}

/**
 * Filter a caller-provided list of preference updates:
 *
 *  - Deduplicate on `type` (last-write wins).
 *  - Drop mandatory types (silently — the FE will render them as
 *    "Wajib", so a well-behaved client won't send them, but a hand
 *    crafted request should still be handled gracefully).
 *
 * This is a defense-in-depth helper for the service's upsertMany.
 */
export function sanitizePreferenceUpdates(
  updates: readonly PreferenceRow[],
): PreferenceRow[] {
  const byType = new Map<NotificationType, PreferenceRow>();
  for (const u of updates) {
    if (mandatoryNotificationTypes.has(u.type)) continue;
    byType.set(u.type, u);
  }
  return Array.from(byType.values());
}
