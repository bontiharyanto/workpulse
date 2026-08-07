import { z } from 'zod';

import {
  accuracyMetersSchema,
  isoDateTimeSchema,
  latitudeSchema,
  longitudeSchema,
} from './common.js';

/**
 * Location Sharing During Shift (ADR-0041).
 *
 * Shared wire shapes for the supervisor-initiated, opt-in,
 * on-demand location share flow. Every request is transparent
 * (user always notified) and one-shot (no continuous polling).
 *
 * Mirrors:
 *   - `LocationShareRequest` + `LocationPing` Prisma models
 *   - DTOs in `apps/api/src/location-sharing/dto/*`
 *
 * Keep this file in sync with both. When adding a field:
 *   1. Extend the Prisma model + generate a migration
 *   2. Extend the class-validator DTO in the api package
 *   3. Extend the matching Zod schema here
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Lifecycle state for a share request. Transitions are enforced
 * server-side; clients only ever *read* the current value.
 *
 *   PENDING     – supervisor asked, user has not yet answered.
 *   RESPONDED   – user accepted and returned a coordinate.
 *   DECLINED    – user explicitly declined.
 *   EXPIRED     – TTL cron flipped it (no user action within 15 min).
 *   CANCELLED   – supervisor withdrew before the user replied.
 */
export const locationShareRequestStatusSchema = z.enum([
  'PENDING',
  'RESPONDED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
]);
export type LocationShareRequestStatus = z.infer<typeof locationShareRequestStatusSchema>;

// ---------------------------------------------------------------------------
// Wire shapes — read
// ---------------------------------------------------------------------------

/**
 * The coordinate payload reported by the user. Numbers, not
 * strings — the wire uses JSON, and Prisma `Decimal` is converted
 * at the DTO boundary in the api package.
 */
export const locationPingSchema = z.object({
  id: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  accuracyMeters: z.number().int().nonnegative(),
  clientCapturedAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});
export type LocationPing = z.infer<typeof locationPingSchema>;

/**
 * A request as seen by the supervisor who created it or the user
 * being asked. `ping` is null in three cases:
 *   1. Status still PENDING / CANCELLED / DECLINED / EXPIRED
 *   2. Status is RESPONDED but the ping's 7-day retention window
 *      already elapsed (request row survives 90 days).
 *   3. Reader is not authorised to see the coord (unlikely in
 *      practice — but we keep the shape stable).
 */
export const locationShareRequestSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  supervisorId: z.string(),
  supervisorName: z.string(),
  targetUserId: z.string(),
  targetUserName: z.string(),
  status: locationShareRequestStatusSchema,
  reason: z.string(),
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  respondedAt: isoDateTimeSchema.nullable(),
  cancelledAt: isoDateTimeSchema.nullable(),
  viewedAt: isoDateTimeSchema.nullable(),
  ping: locationPingSchema.nullable(),
});
export type LocationShareRequestDto = z.infer<typeof locationShareRequestSchema>;

// ---------------------------------------------------------------------------
// Wire shapes — write
// ---------------------------------------------------------------------------

/**
 * Body for `POST /location-sharing/requests`. Reason is
 * mandatory + non-trivial length: the user reads this in the
 * notification and consent screen, so a bare "check" is not
 * acceptable UX (also survives audit review better).
 */
export const createLocationShareRequestSchema = z.object({
  targetUserId: z.string().min(1),
  reason: z.string().trim().min(5).max(200),
});
export type CreateLocationShareRequestInput = z.infer<typeof createLocationShareRequestSchema>;

/**
 * Body for `POST /location-sharing/requests/:id/respond`. Discriminated
 * on `outcome` — the decline path carries no coordinate data at
 * all (privacy-first: never send lat/lng "just in case").
 */
export const respondLocationShareRequestSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('ACCEPT'),
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    accuracyMeters: accuracyMetersSchema,
    clientCapturedAt: isoDateTimeSchema,
  }),
  z.object({
    outcome: z.literal('DECLINE'),
  }),
]);
export type RespondLocationShareRequestInput = z.infer<typeof respondLocationShareRequestSchema>;

// ---------------------------------------------------------------------------
// Self-service opt-in / opt-out (user-facing)
// ---------------------------------------------------------------------------

/**
 * Body for the user-side opt-in endpoint. `consentCopySha` locks
 * consent to the exact copy version the user saw — if Legal
 * revises the wording, the SHA changes and the server rejects
 * stale consent with `CONSENT_COPY_STALE`.
 */
export const updateLocationSharingConsentSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('OPT_IN'),
    consentCopySha: z.string().length(64), // SHA-256 hex digest
  }),
  z.object({
    action: z.literal('OPT_OUT'),
  }),
]);
export type UpdateLocationSharingConsentInput = z.infer<typeof updateLocationSharingConsentSchema>;

/**
 * Read-side shape for `GET /me/location-sharing`. Tells the FE
 * whether to render the opt-in card, the opt-out card, or the
 * "your admin has not enabled this feature" message.
 */
export const locationSharingSelfStatusSchema = z.object({
  /** Tenant-level toggle from SecurityPolicy.locationSharingEnabled. */
  tenantEnabled: z.boolean(),
  /** HR-set User.isFieldWorker. */
  eligible: z.boolean(),
  /** Non-null iff the user is currently opted in. */
  consentedAt: isoDateTimeSchema.nullable(),
  /** SHA the user consented against, or null if never opted in. */
  consentedCopySha: z.string().nullable(),
  /** Current copy SHA the tenant expects. Compare with `consentedCopySha`
   *  — if they differ the FE must re-prompt. */
  currentCopySha: z.string(),
});
export type LocationSharingSelfStatus = z.infer<typeof locationSharingSelfStatusSchema>;
