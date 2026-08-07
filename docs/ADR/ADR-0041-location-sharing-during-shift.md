# ADR-0041 — Location Sharing During Active Shift (voluntary, on-demand)

**Status:** Approved (design locked) — 2026-08-07
**Deciders:** Platform, HR Product, Legal
**Supersedes:** —
**Superseded by:** —

Design is locked; implementation lands in a fresh branch off `main`
after PR #46 (fuzzy-radius) merges. All four open questions were
resolved on 2026-08-07 PM — see the *Open Questions — resolved
2026-08-07* section below for the locked defaults and rationale.

## Context

After ADR-0040 (map picker + Tier-2 signals) + ADR-0040-Rev
(fuzzy radius) shipped, HR asked for a way to verify that field
workers — Sales, Delivery, Field Technicians — are actually where
they say they are during a shift. Clock-in gate alone doesn't cover
that: a delivery driver clock-ins at HQ 08:00 then goes off-map for
the day.

Two dead-end paths we deliberately rejected before drafting this:

- **Silent tracking** — start collecting location after clock-in
  without the employee's knowledge. **NON-STARTER.** UU 27/2022 (UU
  Perlindungan Data Pribadi) Pasal 4 classifies location as
  personal data; Pasal 20 requires *spesifik, sadar, dapat ditarik*
  consent; Pasal 65–67 attach 4–6 year criminal liability and up to
  2% annual-revenue admin fines to non-compliant processing. iOS
  14+ / Android 10+ also enforce a persistent OS indicator so
  "silent" is technically impossible on modern hardware.

- **Continuous background sampling every 15 minutes.** Feasible on
  a native mobile app with signed background-location permission,
  but (a) we don't have a mobile app in the repo (only `apps/api`,
  `apps/web`, `apps/e2e`), (b) requires OS-level persistent
  notification anyway, (c) creates high storage/purge burden, (d)
  raises the consent-validity bar substantially (continuous
  monitoring is meaningfully more invasive than event-based
  sharing).

We evaluated a compliance matrix with HR + legal on 2026-08-07 and
converged on the **on-demand, opt-in, field-worker-only** design in
this ADR.

## Decision — Six Policy Pillars

Every pillar was picked jointly with HR/legal and encoded into
this design:

| # | Pillar                | Choice                                                                                       |
| - | --------------------- | -------------------------------------------------------------------------------------------- |
| 1 | **Eligibility**       | Only users with `User.isFieldWorker = true` (HR toggle per employee)                         |
| 2 | **Sampling model**    | **On-demand ONLY** — supervisor initiates one request, user's app reports current coordinates, then done. No background polling. |
| 3 | **Retention**         | 7 days for `LocationPing` (coord data). 90 days for `LocationShareRequest` (audit metadata). |
| 4 | **Notification**      | User gets real-time push AND email each time supervisor requests OR views their location.    |
| 5 | **Opt-out penalty**   | **Zero.** No financial, evaluation, or administrative penalty. Voluntary in the UU-PDP sense — the sole condition for consent validity under Pasal 20. |
| 6 | **Consent capture**   | Explicit checkbox at `/settings/privacy` with plain-Indonesian disclosure, versioned via existing `UserConsent` + `PrivacyPolicy` machinery. |

### Why on-demand not auto-sample?

Two reasons:

1. **UU PDP proportionality.** Auto-sampling every N minutes
   collects far more personal data than the actual supervision use
   case needs. Pasal 27 requires processing be "proportional to
   the purpose". A supervisor checking "is this driver at the
   customer site?" needs one coordinate at check-time, not 96
   pings a day.

2. **Consent validity strengthens with each check.** Under
   on-demand, the user gets a fresh notification for every check.
   Each notification is an opportunity to withdraw consent
   (Pasal 21). Silent background sampling makes withdrawal
   theoretical only.

### Why field-worker gating?

Auto-eligibility (all EMPLOYEEs opt-in) would let a curious
manager check the location of an office employee — which has no
legitimate business purpose and inflates the DPIA scope. Gating on
`isFieldWorker` scopes the feature to roles where the business
purpose (delivery routing, sales coverage, technician dispatch) is
identifiable, and gives HR a single control point.

## Data Model

Three additions to Prisma schema. All follow the standard
`companyId`-scoped + `deletedAt` conventions (except `LocationPing`
which is hard-deleted by the purge cron).

### `User.isFieldWorker` — new column

```prisma
model User {
  // ... existing columns ...
  isFieldWorker Boolean @default(false)
}
```

HR toggles via the existing user-admin UI. Default `false` means
zero-impact on existing tenants.

### `LocationShareRequest` — new table

```prisma
enum LocationShareStatus {
  PENDING     // Awaiting user's app to fulfill
  FULFILLED   // Coords received
  DENIED      // User explicitly declined via the app
  EXPIRED     // Request TTL passed with no response
}

model LocationShareRequest {
  id            String              @id @default(cuid())
  companyId     String
  requesterId   String              // supervisor / HR who asked
  targetUserId  String              // field worker being asked
  attendanceId  String              // MUST match targetUser's clock-in for today
  requestedAt   DateTime            @default(now())
  respondedAt   DateTime?
  expiresAt     DateTime            // requestedAt + 15 min
  status        LocationShareStatus @default(PENDING)
  reason        String?             // free-text, max 200 chars, shown to target
  pingId        String?             @unique  // FK to LocationPing on fulfill

  company     Company        @relation(fields: [companyId], references: [id], onDelete: Cascade)
  requester   User           @relation("LocationRequester", fields: [requesterId], references: [id], onDelete: Cascade)
  target      User           @relation("LocationTarget", fields: [targetUserId], references: [id], onDelete: Cascade)
  attendance  AttendanceRecord @relation(fields: [attendanceId], references: [id], onDelete: Cascade)
  ping        LocationPing?  @relation(fields: [pingId], references: [id], onDelete: SetNull)

  @@index([companyId, targetUserId, requestedAt])
  @@index([companyId, requesterId, requestedAt])
  @@index([expiresAt])  // for the timeout cron
}
```

### `LocationPing` — new table (short-lived)

```prisma
model LocationPing {
  id             String   @id @default(cuid())
  companyId      String
  userId         String
  attendanceId   String
  latitude       Decimal  @db.Decimal(10, 7)
  longitude      Decimal  @db.Decimal(10, 7)
  accuracyMeters Int
  capturedAt     DateTime  // device timestamp
  receivedAt     DateTime  @default(now())
  purgeAt        DateTime  // set at insert = receivedAt + 7 days

  company    Company          @relation(fields: [companyId], references: [id], onDelete: Cascade)
  user       User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  attendance AttendanceRecord @relation(fields: [attendanceId], references: [id], onDelete: Cascade)

  @@index([companyId, userId, capturedAt])
  @@index([purgeAt])  // for the purge cron
}
```

`LocationPing` is write-once, never mutated. Rows are hard-deleted
by the retention cron — soft delete would silently violate the
7-day promise made to users at consent time.

### `LOCATION_SHARING_DURING_SHIFT` — new UserConsent code

Reuse the existing `UserConsent` model. Add a new consent code
enum value:

```prisma
enum ConsentCode {
  PRIVACY_POLICY
  MARKETING_EMAIL
  LOCATION_SHARING_DURING_SHIFT   // NEW
}
```

Consent is versioned like every other consent — bumping the
disclosure text bumps the version, invalidates prior grants, and
prompts a re-consent flow on next login for opted-in field
workers.

## API Surface

All endpoints go through the standard `JwtAuthGuard` →
`RolesGuard` → `TenantGuard` chain. Tenant isolation is enforced
by service-layer `where.companyId = actor.companyId` filters.

### Employee self-service (`/me/location-sharing/*`)

| Verb   | Path                                       | Purpose                                                                                      | Auth        |
| ------ | ------------------------------------------ | -------------------------------------------------------------------------------------------- | ----------- |
| GET    | `/me/location-sharing/status`              | Returns `{ eligible, consentGranted, consentedAt, activeRequestId, retentionDays }`          | any user    |
| POST   | `/me/location-sharing/consent`             | Grant consent. Body includes disclosure version acknowledged. Fails if `!isFieldWorker`.     | any user    |
| DELETE | `/me/location-sharing/consent`             | Revoke consent. Also expires any PENDING request. Retained pings **keep their 7-day purge schedule** — legal basis for retention is legitimate ops audit for the shift already elapsed. |
| GET    | `/me/location-sharing/requests`            | List my inbound requests (last 30 days). For transparency dashboard.                         | any user    |
| POST   | `/me/location-sharing/requests/:id/fulfil` | Body `{ latitude, longitude, accuracyMeters, capturedAt }`. Only the target can fulfill. Creates `LocationPing` + updates request. | any user    |
| POST   | `/me/location-sharing/requests/:id/deny`   | User explicitly declines. Sets status=DENIED. Audit-logged with target's user ID.            | any user    |

### Supervisor (`/supervisor/location/*`)

| Verb | Path                                | Purpose                                                                                                        | Auth                    |
| ---- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------- |
| POST | `/supervisor/location/request`      | Create a request. Body `{ targetUserId, reason? }`. Server validates: (a) target is a direct report, (b) target is field worker, (c) target has active clock-in today, (d) target has consented. | SUPERVISOR / HR / SUPER |
| GET  | `/supervisor/location/requests`     | List my outbound requests. Filters: date range, status, targetUserId.                                          | SUPERVISOR / HR / SUPER |
| GET  | `/supervisor/location/requests/:id` | Detail with resolved ping (if fulfilled). Server refuses if requester is not the original one (or HR).         | same                    |

HR / SUPER_ADMIN can bypass the "direct report" check because their
scope is company-wide. Every access is audited.

### Admin audit (`/admin/location-sharing/*`)

| Verb | Path                                | Purpose                                                                                            | Auth      |
| ---- | ----------------------------------- | -------------------------------------------------------------------------------------------------- | --------- |
| GET  | `/admin/location-sharing/requests`  | Company-wide paginated audit view: who requested whom, when, with what outcome. Read-only.         | HR / SUPER |

## Notification Contract

Uses existing `NotificationService`. Two new template functions in
`apps/api/src/notification/domain/templates.ts`:

- `locationShareRequested({ requesterName, reason, expiresInMinutes })`
- `locationShareFulfilled({ requesterName, capturedAt })`

Delivery channels: in-app notification (existing) + email (via
`SmtpEmailAdapter`). Web-push is a follow-up when a mobile app
exists.

## Purge Cron

`LocationPingPurgeService` (`@Injectable`) with
`@Cron(CronExpression.EVERY_HOUR)` — hourly is generous for a
7-day promise, keeps the purge chatter bounded even at 100k pings.

```ts
async purge(): Promise<void> {
  const now = new Date();
  const result = await this.prisma.locationPing.deleteMany({
    where: { purgeAt: { lte: now } },
  });
  if (result.count > 0) {
    this.logger.log(`location-ping purge: deleted ${result.count} row(s) older than retention`);
  }
}
```

Symmetric cron `LocationShareRequestExpireService` runs every
5 min — flips `PENDING → EXPIRED` for requests past
`expiresAt`. Notifies requester ("your request to X expired
without a response").

`LocationShareRequest` rows themselves are purged at 90 days
(`purgeShareRequestAuditRetentionDays` config). Longer than pings
because the request metadata (who asked, was it fulfilled?) is
part of the audit trail HR may need for compliance investigations,
while the actual coordinates are not.

## RoPA + DPIA

Two new artifacts, both auto-seeded by the existing
`prisma/seed.ts` under the tenant bootstrap path:

### RoPA activity — `location-sharing-field-workers`

| Field              | Value                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| Purpose            | Supervision of field-tagged employees during active shifts                                        |
| Legal basis        | Konsen (UU PDP Pasal 20, ayat 1(a))                                                               |
| Data categories    | Real-time geographic coordinates, accuracy, timestamps                                            |
| Data subjects      | Employees with `isFieldWorker = true` who have granted `LOCATION_SHARING_DURING_SHIFT` consent    |
| Recipients         | Direct supervisor, HR Manager, Super Admin — of the same tenant only                              |
| Retention          | 7 days for coord pings; 90 days for request audit metadata                                        |
| International xfer | None                                                                                              |
| Technical measures | AES at-rest (Postgres), TLS in transit, tenant + role scoping, immutable audit log                |
| DPIA               | Required (see below); linked ID `DPIA-LOCATION-2026`                                              |

### DPIA template — `dpia-location-sharing-2026`

Uses the existing DPIA form (module `admin/dpia`). Pre-filled
with risk scoring for the on-demand model. Placeholders for the
tenant HR to complete their tenant-specific residual-risk
assessment before flipping the feature on.

Feature ships **behind a per-tenant flag** on `SecurityPolicy`
(new field `locationSharingEnabled Boolean @default(false)`). No
tenant is opted-in by default; SUPER_ADMIN turns it on from
`/admin/security` after their DPIA is filed.

## Audit Log Actions (new)

Added to the existing `AuditLog` action enum-string set:

- `LOCATION_CONSENT_GRANTED`
- `LOCATION_CONSENT_REVOKED`
- `LOCATION_REQUEST_CREATED`
- `LOCATION_REQUEST_FULFILLED`
- `LOCATION_REQUEST_DENIED`
- `LOCATION_REQUEST_EXPIRED`
- `LOCATION_PING_VIEWED`  // fires when supervisor loads request detail
- `LOCATION_PING_PURGED`  // batched cron entry
- `LOCATION_SHARING_TENANT_ENABLED` / `..._DISABLED`

## Frontend surface (Next.js)

### Employee side

- `/settings/privacy` — new section "Location Sharing (Field Workers)":
  - Shown only when `isFieldWorker = true`
  - Clear disclosure box: "What we share, when, with whom, retention"
  - Toggle to grant/revoke
  - History table of past 30 days of requests + outcomes
- `/notifications` — inbox already exists; new template renders inline

### Supervisor side

- `/team/location/request` — new page:
  - List of direct reports flagged `isFieldWorker` + who has consented
  - "Request location" button per row → confirmation dialog with `reason` textarea
  - Live list of pending / fulfilled requests

### HR / Super Admin

- `/admin/security` — add "Location Sharing" tab:
  - Enable/disable toggle at tenant level (requires DPIA-signed acknowledgment)
  - Link to audit view
- `/admin/location-sharing/audit` — company-wide log with filters

## Rollout Plan

1. **PR 1 (this design)** — Prisma schema, backend service+controller,
   consent flow, employee `/settings/privacy` toggle, supervisor
   request page, purge cron, audit. Ships behind
   `SecurityPolicy.locationSharingEnabled = false` — inert until
   SUPER_ADMIN flips.
2. **PR 2 (follow-up)** — RoPA + DPIA seed data, `/admin/security`
   tenant toggle UI, `/admin/location-sharing/audit` page.
3. **Rollout gate** — Legal review of consent copy per language,
   staging QA week, then per-tenant enablement with DPIA-on-file
   check.
4. **Mobile app path (future)** — Not in this ADR. Would add
   background push-triggered auto-fulfillment.

## Alternatives Considered

- **Auto-sampling every 15 min.** Rejected up-front on legal
  proportionality grounds. On-demand achieves the supervision
  goal with fractional data collection.
- **Coarse coordinates (nearest 100 m).** Deferred to a per-tenant
  config option. Some use cases (delivery route audit) need
  building-level precision.
- **HR can request without going through supervisor.** Adopted —
  HR + SUPER_ADMIN bypass the direct-report check (audited).
- **Sharing without express consent, relying on "legitimate
  interest" basis (UU PDP Pasal 20(1)(g)).** Rejected. Legitimate
  interest for continuous location tracking is a high bar; consent
  is unambiguous and travels well across jurisdictions if we
  expand.

## Consequences

**Positive**

- Legally solid — voluntary, transparent, revocable, DPIA'd,
  RoPA-registered, audit-immutable, minimal collection.
- Small implementation surface — no background sampling, no OS
  permissions dance, no mobile app dependency. Feasible in ~3–5
  days of focused work.
- Composes with existing infra (consent, RoPA, DPIA, notification,
  audit, tenant policy, retention cron).

**Negative**

- Web-only for MVP. If the target's browser tab is closed, the
  request will EXPIRE. Field workers on lunch break may miss
  legitimate requests. Mitigated by 15-min TTL + email fallback.
- Two new tables + one new cron. Modest ops overhead.
- Feature is inert (per-tenant flag off) until each tenant DPIAs.
  Not a "install and go" experience.

**Deferred**

- Auto-sampling behind a tenant flag once mobile app exists.
- Coarse coordinates option.
- Historical trajectory playback ("show me all of driver X's pings
  today"). Currently only on-demand and per-request.
- Geofence-crossing alerts ("notify me if X leaves the delivery
  radius"). Requires the geofence dataset to grow — separate ADR.

## References

- ADR-0017 — MFA + `SecurityPolicy` per-tenant table (we extend this)
- ADR-0037 — Retention audit & tenant usage (we align on retention cron patterns)
- ADR-0040 — Geofence map picker & Tier-2 signals (adjacent domain)
- UU 27/2022 (UU PDP) Pasal 4, 16, 20, 21, 27, 34, 65–67
- KEMENKOMINFO PP 71/2019 — data lokasi disebut personal
- `apps/api/src/notification/notification.service.ts`
- `apps/api/src/security-policy/security-policy.service.ts`

## Open Questions — resolved 2026-08-07

The four questions below were closed with the product/HR pairing
call on 2026-08-07 PM. Defaults are locked into PR 1's scope; any
later revision needs its own ADR patch.

- [x] **Consent copy (Indonesian) — legal review timing.**
      *Decision:* copy authored in-repo at
      `apps/web/lib/consent-copy/location-sharing.ts` as the source
      of truth. In-app opt-in ships in PR 1 flagged
      `LOCATION_SHARING_TRACK2_ENABLED=false` per tenant; enabling
      the flag is gated on Legal sign-off of that file's SHA
      (recorded in the DPIA update). This means engineering is
      unblocked without a legal signature on every intermediate
      commit.

- [x] **Request TTL.** 15 minutes. Rationale: matches the "one
      punch, one response" mental model — a supervisor asking
      "where are you *right now*" gets 15 minutes for the employee
      to notice, unlock, and consent. Past 15 min the request
      auto-expires (state `EXPIRED`) and the supervisor must
      re-issue, which re-fires the notification. Shorter (e.g. 5
      min) rejects too many legitimate field-worker responses
      (phone in pocket, in-transit); longer (e.g. 1 h) weakens the
      "immediate check" property and makes the pending-request
      badge feel stale.

- [x] **HR coordinate view.** Map + raw. HR sees the coordinate
      rendered on the same MapLibre component from Track 3 (fed by
      the local PMTiles tile server), plus a copyable
      `lat, lng ± accuracy m` line and a "buka di Google Maps"
      external link as a fallback for triage where the internal
      tile server is degraded. Two-way redundancy also helps DSAR
      export — the raw line is what lands in the JSON.

- [x] **Notification channels — priority.** All three, always.
      Every request AND every coordinate view emits (a) an in-app
      notification, (b) an email, and (c) a Web Push if the
      subscription exists for that user. Rationale: this is a
      privacy-sensitive event where the user's ability to know
      matters more than notification-fatigue economy. Frequency is
      already bounded by supervisor discipline + the 15-min TTL,
      so the volume ceiling is low. Anti-spam quota (max 6
      requests / user / 24h across the tenant, enforced in service
      layer) prevents supervisor abuse from becoming a
      notification-DDoS.

## Rollout gate

PR 1 lands the feature flagged **off** per tenant
(`SecurityPolicy.locationSharingEnabled = false`). SUPER_ADMIN
flips the flag from `/admin/security` **only after** the tenant's
DPIA record (`DpiaAssessment` where `activity = "LOCATION_SHARING"`)
is in status `APPROVED`. The flip itself writes a
`LOCATION_SHARING_ENABLED` audit log entry that includes the
approved DPIA id and the SHA of the consent copy file — this is
the single artifact a regulator would ask for.
