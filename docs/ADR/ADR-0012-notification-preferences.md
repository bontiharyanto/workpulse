# ADR-0012 — Notification Preferences (Per-User Opt-Out)

- **Status:** Accepted
- **Date:** 2026-08-02
- **Deciders:** Backend, Frontend, HR/UX
- **Related:** ADR-0006 (notification strategy — the fanout this ADR
  gates), ADR-0002 (auth strategy — why `PASSWORD_RESET` is mandatory).

## Context

Fanout in the existing notification service delivers every event to
every eligible recipient on both channels (in-app + email). That was
appropriate for MVP — a workforce app where nobody misses an approval
is safer than one where people opt out of the wrong thing on day one.

But we now have 15 event types, some of them low-value for specific
roles (a supervisor doesn't need an email for every `LEAVE_SUBMITTED`
if they already check the approvals queue every morning), and one of
them (`PASSWORD_RESET`) that must remain non-negotiable for security.
Employee interviews surfaced "email fatigue" as the #2 UX complaint
after mobile geofence flakiness. It's time to give users a lever.

## Decision

### D1. Overrides-only storage; default is "everything on"

```
NotificationPreference {
  id, companyId, userId, type,
  emailEnabled, inAppEnabled,
  createdAt, updatedAt,
  @@unique([userId, type])
}
```

- No row for a `(user, type)` pair means **both channels enabled**.
  The DB stores overrides, not the full `|users| × |types|` matrix.
- New users start subscribed to everything. For a workforce app, the
  cost of a slightly noisy inbox is much lower than the cost of
  missing a rejected leave request. Opt-in defaults would create a
  cliff — employees hired after the feature ships would silently
  receive nothing until they visited the settings page.
- Missing-row shortcut also makes the effective lookup essentially
  free — a single-row seek on `(userId, type)` unique key, with a
  fallback to defaults-on when the row is absent. The unique key
  covers the hot path completely.

### D2. Mandatory types (opt-out ignored)

The `mandatoryNotificationTypes` set in
`apps/api/src/notification/domain/preferences.ts` names types the
user cannot silence. **Currently only `PASSWORD_RESET`.**

Rationale: password reset confirmation is a security signal — "someone
just changed your password". Allowing opt-out would let an attacker
who breached a session pre-emptively disable that signal. The list is
intentionally short: adding a type here is a policy decision that
should be flagged in review + this ADR bumped.

The DB has no constraint enforcing this. A row for a mandatory type
can exist (via schema drift or a rogue insert), but the effective
lookup ignores it — `resolveEffective('PASSWORD_RESET', ...)` always
returns `{true, true}`. Keeping enforcement in domain code (not the
DB) means the mandatory list can evolve without a migration each time.

### D3. Two-channel toggle, not a single "muted" flag

We store `emailEnabled` and `inAppEnabled` independently. Reasoning:

- A user who's actively working the app all day wants in-app OFF for
  `OVERTIME_APPROVED` (they can see it in their list) but wants
  email ON so they get a record they can search later.
- Another user wants email OFF (their inbox is full) but in-app ON
  so the bell notification still works.

A single `muted` boolean can't express either preference. Two flags
add ~1 KB to every settings-page render and cost nothing at fanout.

### D4. Fanout gate

`NotificationService.createOne` consults `getEffective` BEFORE the
in-app insert and the email dispatch:

- `inAppEnabled=false` → the DB row is not created. Alternative
  (create-but-hide) was rejected — an unread row that's supposed to
  be invisible would still increment `unreadCount` and show up in
  `list()` calls. Just don't create it.
- `emailEnabled=false` → email dispatch is skipped.
- Both false → whole delivery becomes a no-op (logged at debug).

The preference lookup runs on the CALLER'S transaction handle. This
matters when a leave-approval endpoint wraps the notification in a
`prisma.$transaction` — the preference check must see the same
snapshot as the in-app insert. Otherwise an opt-out that lands mid
flight could create a phantom "you disabled it but still got one"
row visible for a millisecond.

### D5. Endpoints

- `GET /api/v1/notifications/preferences` — returns one row per known
  `NotificationType` (15 today), hydrated with stored overrides or
  defaults-on. Mandatory types come back with `mandatory=true` and
  both flags forced-on.
- `PUT /api/v1/notifications/preferences` — bulk-upsert overrides.
  `{ updates: [{ type, emailEnabled, inAppEnabled }] }`. Empty
  `updates` is a legal no-op that still returns the fresh list.
  Mandatory types in the payload are silently dropped.

Both endpoints operate on the caller's own preferences. There is
no admin lane to edit another user's preferences — HR who wants
to force a delivery already has direct email as a channel.

### D6. Frontend matrix

`/settings/notifications` renders a table grouped by section (Cuti,
Lembur, Absensi, Keamanan). Mandatory rows show a "Wajib" pill with
their toggles disabled. The FE keeps a local draft that only
posts on "Simpan" — one PUT per session-of-clicks, not per toggle.

The response of PUT is authoritative (fresh full list) so the FE
seeds the query cache directly without a follow-up refetch.

## Alternatives considered

1. **Full matrix at signup.** Pre-populate `|types|` rows per new
   user. Rejected: churn every time we add a NotificationType (would
   require a backfill migration), and no observable benefit — the
   overrides-only lookup with a fallback is trivially fast.
2. **Single "muted" flag.** Simpler UX but doesn't cover the "email
   only" / "in-app only" cases described in D3.
3. **Category-level toggles** (mute all leave events, mute all
   overtime events). Nice for future compression but the DB layer
   already supports per-type gating; category rollups are an FE
   concern.
4. **DB-enforced mandatory list** via CHECK constraint. Rejected
   because the mandatory list is expected to churn (security posture
   changes, new event types added). Domain enforcement + a
   `mandatory` flag on the response keeps the schema stable.
5. **Delivery retries** for `emailEnabled` toggles mid-flight.
   Rejected as scope creep — an email that fired at time T with the
   user's then-current preferences is delivered; a user who opts out
   at T+1s doesn't get a "recall" magic.

## Consequences

- New table `NotificationPreference` with unique `(userId, type)`.
  Cascade delete when a user is removed — preferences carry no
  meaning without the owner.
- Every `NotificationService.createOne` call now performs one extra
  index seek (`findUnique` on `(userId, type)`). Negligible cost
  under normal fanout volume; effectively free when it hits the
  index cache.
- Adding a new `NotificationType` still needs to touch two places
  (the Prisma enum + the shared-types Zod schema + the FE label map
  and section grouping). No preference-specific migration required
  — new types automatically default-on via the missing-row path.
- Mandatory list changes are a policy decision documented here.
  Widening it (adding another mandatory type) has essentially no
  cost; narrowing it (making `PASSWORD_RESET` optional) requires a
  security review, not a merge.

## Follow-ups

- Consider a "digest email" mode where opting out of email doesn't
  drop the signal entirely but rolls it into a daily summary. Deferred
  until we hear that from more than one HR partner.
- If admin analytics ever needs "how many users opted out of `X`",
  the secondary index `(companyId, type)` on `NotificationPreference`
  covers that query directly.
- Preference-import flow for CSV-onboarded companies (bulk create a
  set of overrides based on a template). Not needed until we see
  tenants requesting it.
