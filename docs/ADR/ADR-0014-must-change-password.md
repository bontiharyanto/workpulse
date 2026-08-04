# ADR-0014 — Temp-Password Enforcement (must-change-password)

- **Status**: Accepted
- **Date**: 2026-08-02
- **Authors**: Workpulse Platform
- **Supersedes / Related**: [ADR-0002 (Auth & Sessions)](./ADR-0002-auth-and-sessions.md), [ADR-0006 (Notifications)](./ADR-0006-notification-strategy.md)

## Context

HR/admins onboard employees via `POST /admin/users`, which generates a
cryptographically strong 14-character temporary password (see
[`user/domain/temp-password.ts`](../../apps/api/src/user/domain/temp-password.ts)).
The password is displayed **once** through the `CredentialReveal` modal and is
never persisted in plaintext.

Before this ADR, there was no server-side enforcement forcing the new user to
rotate that temp password on first login. Anything a human copied out of the
reveal modal — screenshots, chat DMs, sticky notes — was as good as a
permanent credential. This ADR closes that gap.

## Decision

Introduce a boolean `User.mustChangePassword` and gate every non-`/auth`
endpoint behind a `MustChangePasswordGuard`. The flag is set when an admin
issues a temp password and cleared when the user picks their own.

## Wire contract

- `POST /auth/change-password` (Bearer required)

  Request:

  ```json
  { "currentPassword": "…", "newPassword": "…" }
  ```

  200 on success. Every refresh token for the user (including the one on
  this device) is revoked; the FE must return to `/login`.

  Errors:
  - 401 `INVALID_CREDENTIALS` — user not found or wrong current password
    (single generic code — never distinguish the two)
  - 400 `SAME_PASSWORD` — new equals current
  - 429 `THROTTLER` — 5 attempts / 60 s / IP

- Every other authenticated endpoint returns 403 when the caller's JWT
  reports `mustChangePassword: true`:

  ```json
  {
    "statusCode": 403,
    "code": "PASSWORD_CHANGE_REQUIRED",
    "message": "…"
  }
  ```

- The `AuthenticatedUserDto` (returned by `/auth/me` and embedded in
  `LoginResponseDto.user`) always carries `mustChangePassword: boolean`.

### Endpoints on the guard allowlist

Marked with `@AllowMustChangePassword()`:

- `POST /auth/change-password` — the escape hatch itself
- `GET /auth/me` — FE bootstrap needs to read the flag
- `POST /auth/logout`, `POST /auth/logout-all` — user must be able to abandon
  a broken session

Every other route is blocked.

## Data model

```prisma
model User {
  …
  mustChangePassword Boolean @default(false)
}
```

Migration `20260802120000_add_must_change_password/migration.sql` adds the
column with a `false` default so existing rows are unaffected. Rows created
via `UserAdmin.create` or refreshed via `UserAdmin.resetPassword` explicitly
set `true`.

## Life-cycle transitions

| Event                                         | Flag set to |
| --------------------------------------------- | ----------- |
| Admin creates user                            | `true`      |
| Admin issues password reset                   | `true`      |
| Self-service `/auth/change-password` succeeds | `false`     |
| Email-based `/auth/reset-password` succeeds   | `false`     |

Both reset paths also invoke `TokenService.revokeAllForUser` so any
outstanding session is severed the moment the password changes.

## Design highlights

- **Guard registration order.** `MustChangePasswordGuard` is registered
  AFTER `JwtAuthGuard` (so `req.user` is populated) but BEFORE `RolesGuard`
  (so a temp-password caller cannot slip through role checks). See
  `app.module.ts`.
- **JWT-embedded flag.** The claim is baked into the access token so the
  guard does not need a DB roundtrip. Cost: after an admin reset the
  in-flight token still reports `false` until it expires (≤ 15 min). The
  refresh token is revoked at reset time, so the caller cannot renew — the
  window is bounded by `JWT_EXPIRES_IN`.
- **Legacy tolerance.** `AuthenticatedUser.mustChangePassword` is optional
  in TypeScript. Older JWTs (issued before this feature landed) that lack
  the claim are treated as `false` — safe direction: we never lock a user
  out because of a missing claim.
- **Error-code separation.** The exception filter now honors an explicit
  `code` field on thrown payloads. Previously the message was used as the
  code — now we send `PASSWORD_CHANGE_REQUIRED` for the guard and keep the
  human-readable Indonesian copy in `message`. The FE keys off `code`.
- **Extras forwarding.** The same rewrite of
  [`HttpExceptionFilter`](../../apps/api/src/common/filters/http-exception.filter.ts)
  also spreads any non-reserved keys from the thrown payload onto the
  JSON body (e.g. `cutoffDate` on `PAYROLL_LOCKED`, `retryAfter`, …).
  Reserved keys (`statusCode`, `code`, `message`, `details`, `error`,
  `path`, `timestamp`) are always produced by the filter itself and
  cannot be spoofed by callers. Regression-covered by
  [`http-exception.filter.spec.ts`](../../apps/api/src/common/filters/http-exception.filter.spec.ts).
- **Login UX.** On successful login the FE inspects
  `res.user.mustChangePassword`; if `true`, it replaces the redirect target
  with `/change-password` before rendering the dashboard. The dashboard
  `RequireAuth` wrapper mirrors the check so a manually-typed URL is also
  bounced.
- **Password change UX.** The `/change-password` page is served under the
  `(auth)` route group (no dashboard chrome), and shows the "temporary
  password" banner only when the flag is set — the same form is reused for
  voluntary rotation.

## Security considerations

- Same generic `INVALID_CREDENTIALS` code for both "user not found" and
  "wrong current password" — a caller with only a stolen access token
  cannot confirm account existence.
- Login is aggressively rate-limited (5/60 s/IP). `change-password` uses
  the same 5/60 s throttle. Both are neutralised in test environments via
  the opt-in `THROTTLER_DISABLED` env flag; env validation refuses the
  combination `NODE_ENV=production` + `THROTTLER_DISABLED=true`.
- The temp password is never stored in the audit log — audit entries for
  `USER_CREATED` and `PASSWORD_RESET_BY_ADMIN` include the user row with
  `passwordHash` stripped, and never the plaintext.
- On successful change we revoke ALL refresh tokens (this device included).
  Consistent with the email-based reset flow. Cost is one extra login;
  benefit is a hard boundary between "before" and "after" credentials.

## Ops considerations

- No new cron. No new external dependencies.
- `THROTTLER_DISABLED=true` in `apps/e2e/playwright.config.ts` (`webServer.api.env`)
  is the ONLY blessed way to bypass rate limiting; leave the flag `false`
  everywhere else.
- Existing users (pre-migration) default to `false` — nothing to backfill.

## Explicitly out of scope

- **Password history / complexity rules.** Server enforces length ≥ 8 only.
  Complexity guidance lives in the FE copy. If tenant policy demands more,
  bolt a domain module on top of `PasswordService` — do not creep the
  auth service.
- **Temp-password expiry.** A stale, un-rotated temp password is left in
  place indefinitely. If HR wants a hard "must rotate within 7 days"
  policy, extend the flag with `mustChangePasswordDeadline: DateTime?`
  and refuse LOGIN (not just protected endpoints) once past the deadline.
- **Grace period after rotation.** No "you cannot change the password
  twice in 5 minutes" throttle beyond the shared 5/60 s IP-level
  ThrottlerGuard.

## Verification

Unit tests:

- [`auth.service.spec.ts`](../../apps/api/src/auth/auth.service.spec.ts) —
  `changePassword` happy path, SAME_PASSWORD guard, INVALID_CREDENTIALS
  branch, token revocation ordering.
- [`must-change-password.guard.spec.ts`](../../apps/api/src/auth/guards/must-change-password.guard.spec.ts) —
  `@Public()` / `@AllowMustChangePassword()` allowlists, no-user pass-through,
  403 with `PASSWORD_CHANGE_REQUIRED` code.
- [`user-admin.service.spec.ts`](../../apps/api/src/user/user-admin.service.spec.ts) —
  create + reset re-arm the flag.
- [`password-reset.service.spec.ts`](../../apps/api/src/auth/password-reset.service.spec.ts) —
  email-based reset also clears the flag.
- [`http-exception.filter.spec.ts`](../../apps/api/src/common/filters/http-exception.filter.spec.ts) —
  `code` promotion, `cutoffDate` extras pass-through, reserved-key
  spoofing defense, VALIDATION_FAILED array-message shortcut.

E2E:

- [`change-password.spec.ts`](../../apps/e2e/tests/change-password.spec.ts) —
  temp-login enforcement, happy-path rotation, admin re-arm, UI redirect
  from `/login`, UI success toast from `/change-password`.
