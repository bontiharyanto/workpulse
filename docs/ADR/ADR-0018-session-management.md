# ADR-0018 — Self-service Session / Device Management

- **Status**: Accepted
- **Date**: 2026-08-02
- **Authors**: Workpulse Platform
- **Supersedes / Related**: [ADR-0002 (Auth & Sessions)](./ADR-0002-auth-strategy.md), [ADR-0017 (MFA / TOTP)](./ADR-0017-mfa-totp.md)

## Context

Workpulse issues rotating refresh tokens per login (see
[ADR-0002](./ADR-0002-auth-strategy.md)) — each device that logs in gets
its own `RefreshToken` row. Before Fase 30b, users could only "logout
here" (drop the local cookie) or "logout everywhere" (via password
change / hard admin action). Neither was safe when a user suspected a
single device was compromised: dropping the local cookie leaves the
attacker's session alive, and a full-sweep logout also kills every
legitimate device the user is signed into.

We also need a way to *see* what is signed in — a laptop, a work
phone, a shared tablet — so users can recognise unexpected activity.

## Decision

Ship a self-service session panel under `/settings/security`, backed by
three endpoints scoped strictly to the caller:

- `GET /api/v1/auth/sessions` — list every ACTIVE, non-expired refresh
  row for the caller. Each row carries an `isCurrent` flag computed by
  SHA-256-hashing the caller's `wp_refresh` cookie and comparing to
  `RefreshToken.tokenHash`.
- `DELETE /api/v1/auth/sessions/:id` — revoke one session (own or
  someone else's is rejected with 404 `SESSION_NOT_FOUND`, never a
  different code — no information leak about foreign IDs).
- `POST /api/v1/auth/sessions/revoke-others` — sweep every ACTIVE row
  EXCEPT the caller's current one. Returns `{ revokedCount }` so the
  UI can render a confirmation toast.

Cross-user revocation stays out of this surface: admins reset users
through the existing `POST /admin/users/:id/reset-password` /
`deactivate` paths, which already audit correctly. Sessions here are
personal.

## Wire contract

`SessionDto` mirrors [`session.dto.ts`](../../apps/api/src/auth/session/dto/session.dto.ts):

```ts
{
  id: string;              // RefreshToken.id — revocation path param
  userAgent: string | null;
  ip: string | null;
  mfaVerified: boolean;    // has this session cleared MFA (login or step-up)?
  createdAt: string;       // ISO
  expiresAt: string;       // ISO — natural TTL of the refresh chain
  isCurrent: boolean;      // true iff this row backs the caller's refresh cookie
}
```

The raw `tokenHash` NEVER leaves the DB. `RefreshToken.mfaVerified` is
exposed so users can distinguish "this session cleared 2FA" from
"legacy session created before MFA was on"; there is no separate
disclosure risk because MFA enrollment is already visible via
`GET /auth/mfa/status`.

## Guards & authorisation

Session routes sit behind `JwtAuthGuard`, `MustChangePasswordGuard`,
`MfaVerifiedGuard`, and `MfaEnrollmentGuard` (the default global
stack). We deliberately do NOT expose them under
`@AllowUnverifiedMfa()` — a pre-MFA session cannot enumerate or revoke
devices, closing the "attacker who stole a first-factor cookie enumerates
your other devices" hole.

## Data model

No schema changes. We reuse the existing
[`RefreshToken`](../../apps/api/prisma/schema.prisma) table. The
service filters to `status = ACTIVE` and `expiresAt > now()`; expired
rows are hidden from the UI (they're already unusable) even though they
linger in the DB until a background sweep.

## Design highlights

- **Current-session detection is client-supplied.** The `wp_refresh`
  cookie is HttpOnly, so the JS bundle can't know its value — but the
  browser attaches it to every request, and the server hashes it into
  `tokenHash` for comparison. There is exactly one authoritative
  `isCurrent` flag; the FE trusts the server.

- **Revoke uses `POST … updateMany` + audit in a single
  `$transaction`.** Every state change writes an `AuditLog` row inside
  the same transaction (`SESSION_REVOKED` for a single row,
  `SESSION_REVOKED_OTHERS` with `{ count }` payload for the sweep) —
  consistent with the "sensitive mutation MUST audit" invariant from
  the workspace security rules.

- **Idempotency guard.** Deleting an already-`REVOKED` row surfaces a
  403 `SESSION_ALREADY_REVOKED`, not a silent 204. It lets the FE
  distinguish "concurrent revoke won the race" (harmless) from "I
  clicked the wrong row" (worth surfacing).

- **Self-destruct is allowed.** Revoking your own `isCurrent` row
  returns 204 and the very next `/auth/refresh` 401s. The FE panel
  bounces to `/login` in that case; the same code path also handles
  administrator-initiated revocation on other devices.

- **Rate limiting.** Per-caller throttler: 30 revokes/min and 10
  revoke-others/min. Enough headroom for legitimate cleanup, tight
  enough to blunt brute-force ID enumeration.

## Frontend surface

- **`/settings/security` — SessionsPanel.** Neighbour of the existing
  MFA panel. Lists sessions newest-first with a device label
  (best-effort UA heuristic — Chrome/Firefox/Safari on Windows/macOS/…
  keeps the bundle small vs shipping a full UA parser), IP, MFA badge,
  and login/expiry timestamps. "Sesi ini" pill on the current row.

- Per-row **Logout perangkat** button with a 2-click confirm inline;
  the top-right **Logout semua sesi lain** button drives the bulk
  action and disables itself when only the current row remains.

- On self-revoke, the panel calls `authStore.clear()` and does a full
  `window.location.assign('/login')` — mirrors the MFA disable flow.

## Security considerations

- **No information leak on foreign IDs.** Foreign or unknown IDs both
  return 404 with `SESSION_NOT_FOUND`. An attacker can't distinguish
  "ID exists but belongs to someone else" from "ID doesn't exist".

- **Audit trail is append-only.** The `SESSION_REVOKED[_OTHERS]`
  actions land in the same immutable `AuditLog` table that already
  records login / password-change events. Reviewers can reconstruct
  who cancelled which session at what time.

- **Refresh cookie replay after revoke** — the token is marked
  `REVOKED`; the reuse-detection path in
  [`TokenService.rotate`](../../apps/api/src/auth/token.service.ts)
  now sees `status !== ACTIVE` and burns the whole family. That is
  intentional: if a stolen cookie is still being replayed after the
  legitimate user revoked, the resulting family sweep is a no-op
  (everything is already dead) but produces a warning log worth
  alerting on later.

## Trade-offs & alternatives considered

- **Session ID as a separate opaque handle instead of `RefreshToken.id`.**
  Rejected — the extra column has no security value (the ID is already
  scoped to the caller by ownership check) and would require a UUID
  column + index migration. `RefreshToken.id` is already a `cuid()`
  and is not sensitive.

- **"Trust this device" long-lived cookies.** Explicitly out of scope
  for 30b. Would let a user skip the MFA step for 30 days on a marked
  device; we deferred it because it requires a separate device-trust
  primitive and its own revocation UI. Session management here is
  strictly *seeing and killing* sessions, not extending them.

- **Show geolocation from IP.** Rejected for the MVP — resolving IP to
  city requires an external DB (MaxMind or similar) and drags in a new
  ops dependency. IP + UA is enough for the "does this look like me?"
  check.

## Ops / rollout

- No new env vars.
- No new DB migration (feature reads existing `RefreshToken` rows).
- Backward-compatible with sessions issued before Fase 30b — the
  `mfaVerified` field defaults to `true` for legacy rows (see
  [ADR-0017](./ADR-0017-mfa-totp.md)) so the panel doesn't panic-mark
  every historical login as insecure.

## Verification

- **Unit** — [`session.service.spec.ts`](../../apps/api/src/auth/session/session.service.spec.ts)
  covers 10 cases: listing, current-hash matching, ownership 404,
  idempotency 403, sweep with/without cookie, audit-skip on empty
  sweep.
- **E2E API** — [`sessions.spec.ts`](../../apps/e2e/tests/sessions.spec.ts)
  covers 7 flows including cross-user 404 and unauth 401.
- **E2E UI** — [`sessions-ui.spec.ts`](../../apps/e2e/tests/sessions-ui.spec.ts)
  drives the panel through list, single-revoke, and revoke-others in a
  serial file (each test prunes to a one-session baseline via
  `pruneToOneSession`).
- Full API unit suite: 730 pass. Full E2E: 126 pass.
