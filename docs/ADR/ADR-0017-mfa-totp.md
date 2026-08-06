# ADR-0017 — Multi-Factor Authentication (TOTP + Backup Codes)

- **Status**: Accepted — **Revised 2026-08-06 (twice)**
- **Date**: 2026-08-02
- **Authors**: Workpulse Platform
- **Supersedes / Related**: [ADR-0002 (Auth & Sessions)](./ADR-0002-auth-strategy.md), [ADR-0014 (Must-change-password)](./ADR-0014-must-change-password.md)

## Revision 2 — Per-tenant DB toggle (2026-08-06 PM)

The env flag `MFA_ENFORCE_HR_ADMIN` was a **global boot-time**
switch. Ops (or, in single-tenant installs, the customer's IT) had
to edit the env, redeploy, and re-boot the API to change the tenant's
security posture. That's inappropriate for a multi-tenant SaaS where
each customer decides their own compliance posture.

We introduce a new `SecurityPolicy` model, one row per Company:

```prisma
model SecurityPolicy {
  id                        String   @id @default(cuid())
  companyId                 String   @unique
  mfaEnforceHighPrivileged  Boolean  @default(false)
  updatedAt                 DateTime @updatedAt
  updatedById               String?
  createdAt                 DateTime @default(now())
  // relations elided
}
```

**Runtime contract**:

- `MfaEnrollmentGuard` reads the caller's tenant policy via
  `SecurityPolicyService.getForCompany`, which memoises the result
  in a short-TTL in-process cache (`POLICY_CACHE_TTL_MS = 30_000`).
  A toggle from `/admin/security` takes effect within the TTL
  window on other replicas; the local replica sees the change
  immediately via cache invalidation.
- `PATCH /admin/security/policy` is `SUPER_ADMIN`-only and emits
  an `audit_logs` row with action `SECURITY_POLICY_UPDATED`,
  `beforeJson` + `afterJson` capturing the change.
- The env `MFA_ENFORCE_HR_ADMIN` is now **bootstrap-only**: it seeds
  the initial `mfaEnforceHighPrivileged` value on the first
  `getForCompany` call for a fresh tenant. Once the row exists, the
  env is ignored for that tenant.

**Path back to enforcement (unchanged)** — a customer flips the
toggle at `/admin/security` after their internal rollout drive
lands. No API restart, no ops ticket.

## Revision 1 — MVP enrollment policy (2026-08-06 AM)

The **original decision** below made TOTP enrollment mandatory for
`HR_MANAGER` and `SUPER_ADMIN`, enforced via `MfaEnrollmentGuard`
whenever `MFA_ENFORCE_HR_ADMIN=true` — and the env validator refused
to boot with `false` under `NODE_ENV=production`.

Pilot feedback from the customer's HR team revealed a rollout blocker:
authenticator-app onboarding is a non-trivial support cost when many
HR staff don't yet have company-issued phones or IT support to guide
them. Forcing enrollment on first login turned MFA into a
deployment-day incident risk.

Effective 2026-08-06 AM, MFA becomes **opt-in for every role** in the
MVP:

- `MFA_ENFORCE_HR_ADMIN` default flips from `'true'` → `'false'`.
- The `env.validation` block that refused `false` in production is
  removed.
- The MFA **feature** stays fully intact: `/setup-mfa`,
  `/settings/security`, `MfaVerifiedGuard`, backup codes, encrypted
  secrets, and every audit-log emission continue to work. Users who
  enrol voluntarily are still challenged at every login.
- Seed data still enrolls one demo HR user (`hr2@acme.test`) so UAT
  can exercise the flow; the primary HR account (`hr@acme.test`)
  intentionally has no MFA so happy-flow demos aren't blocked on
  TOTP setup.

**Path back to enforcement** — the future hardening milestone:

1. Communicate with HR + provide authenticator-app rollout guide.
2. Run a "self-enroll drive" for two weeks; monitor
   `mfaEnabledUsers` count via `/admin/reports`.
3. Once enrollment is ≥95% of the target cohort, flip the tenant
   toggle at `/admin/security` (**Revision 2**) — no env change,
   no restart.
4. Restore the `env.validation` `superRefine` that refuses `false`
   with `NODE_ENV=production` (see the TODO comment left in
   `env.validation.ts`) — behind a new `MFA_ENFORCE_OVERRIDE_ACK=true`
   opt-out env to allow reversible incident-response toggles.

Everything below this section documents the original design; the
enrollment gate behaviour is the only knob that changed.

---


## Context

Workpulse's authentication surface, prior to Fase 30a, was single-factor
(password + refresh cookie). High-privilege roles — `HR_MANAGER` and
`SUPER_ADMIN` — can read the entire tenant's payroll-adjacent history and
mutate every user account. A leaked password on those accounts is a
tenant-wide breach.

The organisation also wants voluntary MFA for regular employees and
supervisors: it is a cheap, well-understood control and the industry
default for SaaS admin surfaces. We picked TOTP (RFC 6238, 6-digit,
30-second step, SHA-1 default) because every widely-deployed
authenticator app supports it (Google Authenticator, Authy, 1Password,
Microsoft Authenticator).

## Decision

Add a second factor to the session lifecycle. Enrollment is voluntary
for `EMPLOYEE` and `SUPERVISOR`; **mandatory** for `HR_MANAGER` and
`SUPER_ADMIN`. Session state gains a `mfaPassed` claim; the enrollment
policy gains a `mfaEnrollmentRequired` signal exposed to the FE.

TOTP secrets are AES-256-GCM encrypted at the application layer with a
key from `MFA_SECRET_ENCRYPTION_KEY` — the DB alone is insufficient to
generate valid codes. Backup codes are one-time, hashed (bcrypt-style
via `PasswordService`), and stored in a dedicated table so replay is
enforced by a `usedAt IS NULL` uniqueness check.

## Wire contract

All endpoints live under `/api/v1/auth/mfa/*` (see
[`mfa.controller.ts`](../../apps/api/src/auth/mfa/mfa.controller.ts)).

- `POST /auth/mfa/enroll/start` (Bearer, `@AllowMfaEnrollmentPending`)

  Returns a fresh un-persisted secret + a rendered QR code PNG:

  ```json
  {
    "otpauthUrl": "otpauth://totp/Workpulse:user@acme.test?secret=…",
    "qrCodeDataUri": "data:image/png;base64,…",
    "secret": "JBSWY3DPEHPK3PXP"
  }
  ```

  Idempotent for the caller: repeated calls before confirmation return a
  fresh secret and invalidate the previous one.

- `POST /auth/mfa/enroll/confirm` (Bearer, `@AllowMfaEnrollmentPending`)

  Body: `{ "code": "123456" }`. On success activates MFA, issues a batch
  of backup codes (default 8, from `MFA_BACKUP_CODES_COUNT`), and rotates
  the access token so `mfaPassed=true` and `mfaEnabled=true`:

  ```json
  {
    "backupCodes": ["ABCD1234", "…"],
    "accessToken": "…",
    "accessTokenExpiresIn": 900
  }
  ```

  Errors:
  - 401 `MFA_INVALID_CODE` — TOTP mismatch
  - 400 `MFA_ENROLLMENT_NOT_STARTED` — no pending secret
  - 409 `MFA_ALREADY_ENABLED` — reset via disable first

- `POST /auth/mfa/verify` (Bearer, pre-MFA token, `@AllowUnverifiedMfa`)

  Body: exactly one of `{ "code": "123456" }` OR
  `{ "backupCode": "ABCD1234" }`. On success rotates the access token to
  `mfaPassed=true` and marks the current refresh token
  `mfaVerified=true`:

  ```json
  {
    "accessToken": "…",
    "accessTokenExpiresIn": 900,
    "usedBackupCode": false
  }
  ```

  Errors:
  - 401 `MFA_INVALID_CODE`
  - 401 `MFA_MISSING_REFRESH` — cookie absent (mid-login state broken)
  - 400 `MFA_NOT_ENABLED` — user has no second factor
  - 429 `THROTTLED` — 10/60 s IP

- `POST /auth/mfa/backup-codes/regenerate` (Bearer, MFA-verified)

  Body: `{ "code": "123456" }` (fresh TOTP required). Deletes every
  outstanding backup code and issues a new batch of
  `MFA_BACKUP_CODES_COUNT`.

- `DELETE /auth/mfa` (Bearer, MFA-verified)

  Body: `{ "currentPassword": "…", "code": "123456" }`. Requires BOTH
  factors again to shed MFA — a live cookie alone must not be enough.
  On success revokes every refresh token for the user (defense-in-depth
  parity with `changePassword` / admin reset).

- `GET /auth/mfa/status` (Bearer)

  ```json
  {
    "enabled": true,
    "enabledAt": "2026-08-02T13:42:00.000Z",
    "remainingBackupCodes": 7
  }
  ```

### Login-flow changes

- `POST /auth/login` (existing) — response now includes:

  ```json
  {
    "accessToken": "…",
    "accessTokenExpiresIn": 900,
    "mfaRequired": true,
    "user": {
      "…": "…",
      "mfaEnabled": true,
      "mfaPassed": false,
      "mfaEnrollmentRequired": false
    }
  }
  ```

  When `mfaRequired=true` the access token has `mfaPassed=false` and is
  only accepted on `@AllowUnverifiedMfa` routes (currently
  `/auth/mfa/verify`, `/auth/me`, `/auth/logout*`,
  `/auth/change-password`).

- `AuthenticatedUserDto` gains three fields (all always present):
  - `mfaEnabled: boolean` — has the user completed enrollment?
  - `mfaPassed: boolean` — did the current access token clear the
    second factor?
  - `mfaEnrollmentRequired: boolean` — mirror of the backend
    `MfaEnrollmentGuard` decision (role ∈ mandatory ∧ not enrolled ∧
    `MFA_ENFORCE_HR_ADMIN` on) so the FE can pre-empt the 403.

## Guards & session lifecycle

Two new guards register globally in
[`app.module.ts`](../../apps/api/src/app.module.ts):

1. `MfaVerifiedGuard` — refuses requests when the access token carries
   `mfaEnabled=true` **and** `mfaPassed=false`, unless the target route
   is decorated with `@AllowUnverifiedMfa()` or
   `@AllowMustChangePassword()`. Emits:

   ```json
   { "statusCode": 403, "code": "MFA_REQUIRED", "message": "…" }
   ```

2. `MfaEnrollmentGuard` — refuses requests from `HR_MANAGER` /
   `SUPER_ADMIN` accounts that have never enrolled MFA, unless the
   route is decorated with `@AllowMfaEnrollmentPending()` or
   `@AllowMustChangePassword()`, OR the env `MFA_ENFORCE_HR_ADMIN` is
   `false` (see §Ops). Emits:

   ```json
   { "statusCode": 403, "code": "MFA_ENROLLMENT_REQUIRED", "message": "…" }
   ```

**Guard ordering.** `MustChangePasswordGuard` → `MfaVerifiedGuard` →
`MfaEnrollmentGuard` → `RolesGuard`. Rationale: temp-password holders
must never be forced through MFA (they cannot use the account at all
yet); a pre-MFA session must be blocked before role checks kick in so
role-scoped 403s never leak "this endpoint exists" info to attackers.

Endpoints on the `@AllowUnverifiedMfa` allowlist: `POST /auth/mfa/verify`
only. Endpoints on the `@AllowMfaEnrollmentPending` allowlist:
`POST /auth/mfa/enroll/start`, `POST /auth/mfa/enroll/confirm`,
`GET /auth/mfa/status`, `GET /auth/me`, `POST /auth/logout*`,
`POST /auth/change-password`.

## Data model

```prisma
model User {
  …
  mfaSecret     String?          // AES-256-GCM ciphertext (base64)
  mfaEnabledAt  DateTime?        // null iff not enrolled
  mfaBackupCodes MfaBackupCode[]
}

model MfaBackupCode {
  id        String    @id @default(cuid())
  userId    String
  codeHash  String    @unique   // bcrypt-style, via PasswordService
  usedAt    DateTime?           // null iff still redeemable
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, usedAt])
}

model RefreshToken {
  …
  mfaVerified Boolean @default(true)  // false for pre-MFA tokens
}
```

Migration `20260802140000_add_mfa/migration.sql` adds all three
extensions. Existing rows default to "MFA not enabled" (`mfaSecret=NULL`,
`mfaEnabledAt=NULL`) and every existing refresh token is treated as
`mfaVerified=true` (safe direction: it was issued before MFA existed,
so there is no second factor to skip).

## Design highlights

- **Encrypted secret storage.** `mfaSecret` is AES-256-GCM ciphertext
  (base64 IV ‖ tag ‖ ciphertext). Key material lives in
  `MFA_SECRET_ENCRYPTION_KEY` (base64 32 bytes), validated at boot. A
  DB dump is therefore insufficient to mint valid TOTP codes.
- **Backup code hygiene.** Codes are 8 characters, base32 alphabet,
  hashed with the same argon2id parameters as passwords. Unique index
  on `codeHash` gives fail-fast collision detection at insert time.
  Redemption is atomic (`UPDATE … WHERE usedAt IS NULL RETURNING …`).
- **`mfaRequired` in login response.** Rather than encoding MFA
  state inside the access token only, `POST /auth/login` explicitly
  echoes `mfaRequired: boolean`. The FE uses it to jump to `/login/mfa`
  without an extra `/auth/me` round-trip.
- **`mfaEnrollmentRequired` in `AuthenticatedUserDto`.** The FE gate
  on `/setup-mfa` used to compute role membership itself — but the
  backend's `MfaEnrollmentGuard` also consults `MFA_ENFORCE_HR_ADMIN`,
  and if the FE ignored that flag, an env-off environment would still
  force an unnecessary redirect. Baking the decision on the server
  keeps both surfaces in lockstep and lets E2E disable enforcement
  without patching the FE.
- **Pre-MFA refresh cookies.** New refresh rows are created with
  `mfaVerified=false` on password-only logins. `TokenService.rotate`
  short-circuits into `mfaVerified=false` output, so a stale pre-MFA
  cookie can never be silently upgraded across a refresh — the caller
  must go through `/auth/mfa/verify` first.
- **Step-up token rotation.** On successful `/auth/mfa/verify` we mint
  a **fresh** access + refresh pair rather than editing the claim on
  the existing token. Same pattern as `changePassword`.
- **Backup-code single use.** Each code is deleted from the "remaining"
  pool on redemption (`usedAt` timestamp). A replay of a used code
  returns `MFA_INVALID_CODE` — deliberately generic to not disclose
  "this code exists but is spent".
- **Disable requires both factors.** `DELETE /auth/mfa` needs
  password + TOTP, mirroring the login step-up: a stolen live session
  alone MUST NOT be enough to weaken the account.

## Frontend surface

- `/login/mfa` — MFA verify step. TOTP tab (6-digit input) or backup
  code tab. Reachable only mid-login (pre-MFA session); a fully-verified
  session auto-bounces to the dashboard.
- `/setup-mfa` — Forced enrollment (`variant="forced"`) for HR/SA who
  have `mfaEnrollmentRequired=true`. Displays the enrollment wizard
  and, on success, the one-time backup code sheet.
- `/settings/security` — Voluntary MFA management for every role.
  Wraps `MfaManagementPanel`: status card, enrollment wizard,
  regenerate-backup-codes flow, disable flow (password + TOTP).

The `<RequireAuth>` gate enforces the following redirect priority (in
order): `unauthenticated` → `/login`, `mustChangePassword` →
`/change-password`, `mfaEnabled ∧ ¬mfaPassed` → `/login/mfa`,
`mfaEnrollmentRequired` → `/setup-mfa`.

## Security considerations

- Generic `MFA_INVALID_CODE` for wrong TOTP, wrong backup, spent
  backup, or expired session — never disclose which.
- Throttling: `POST /auth/mfa/verify` is 10/60 s per IP;
  `POST /auth/mfa/enroll/*` and `DELETE /auth/mfa` are 5/60 s.
  Same `THROTTLER_DISABLED` bypass as everywhere else (test-only,
  refused in production).
- Constant-time comparison in `crypto.constantTimeEqual` for tag
  verification; TOTP verification defers to `otplib` which is
  constant-time-safe internally.
- The QR code PNG is rendered server-side. Never leaks the secret in
  logs (the panel only shows the human-typable fallback when the user
  expands `<details>`).
- Backup codes are shown **once** in the response of
  `POST /auth/mfa/enroll/confirm` and never returned again. If the
  user loses them, `POST /auth/mfa/backup-codes/regenerate` mints a
  fresh batch and invalidates the old one.
- Audit log entries emitted (all under `AuthAuditAction`):
  - `MFA_ENROLL_STARTED`, `MFA_ENROLL_COMPLETED`,
    `MFA_ENROLLMENT_ABANDONED` (superseded)
  - `MFA_VERIFY_SUCCESS`, `MFA_VERIFY_FAILURE` (with TOTP / backup
    distinguisher in `afterJson`)
  - `MFA_BACKUP_REGENERATED`
  - `MFA_DISABLED`

## Ops considerations

- **`MFA_SECRET_ENCRYPTION_KEY`** — base64-encoded 32-byte key. Env
  validator refuses missing/short values in production. Rotate by
  running a batch job that decrypts under the old key and re-encrypts
  under the new one (not implemented in Fase 30a; see §out of scope).
- **`MFA_ENFORCE_HR_ADMIN`** — MVP default `false` (see revision at
  the top of this ADR). No environment refuses either value. E2E pins
  it explicitly to `false` in `apps/e2e/playwright.config.ts`
  (`webServer.api.env`) so seed HR/SA can log in without pre-enrolling
  MFA regardless of the ambient default. Flip to `true` after HR
  self-enrolls to a satisfactory rate; see the "Path back to
  enforcement" checklist in the revision section.
- **`MFA_ISSUER`** — default `Workpulse`. Shown in the authenticator
  app entry.
- **`MFA_BACKUP_CODES_COUNT`** — default 8; range 4–20 enforced by
  env validator.

## Explicitly out of scope

- **WebAuthn / hardware keys.** TOTP only for now. WebAuthn is a
  future ADR — the schema is deliberately extensible (add a
  `MfaFactor` table when we need multiple factor types per user).
- **Recovery-by-email.** Losing both TOTP and every backup code means
  the user contacts an admin. Admin recovery flow lives in the
  existing password-reset surface + a new `MFA_ADMIN_DISABLE` audit
  action (not implemented in Fase 30a).
- **Key rotation for `MFA_SECRET_ENCRYPTION_KEY`.** Manual for now —
  no scheduled rotation job. Ship an `mfa:reencrypt` command when the
  first key rotation is imminent.
- **Rate-limit-per-user (not just per-IP) for `/auth/mfa/verify`.**
  Current per-IP throttler is enough to defeat online brute force at
  10^-4 chance/minute; a per-user hardening pass belongs in a later
  security ADR.

## Verification

Unit tests (65 suites, 720 tests total; MFA-specific highlighted):

- [`crypto.spec.ts`](../../apps/api/src/auth/mfa/domain/crypto.spec.ts) —
  round-trip encrypt/decrypt, tamper detection (AAD, ciphertext, IV,
  tag mutations all rejected), invalid-key surface.
- [`totp.spec.ts`](../../apps/api/src/auth/mfa/domain/totp.spec.ts) —
  RFC 6238 test vectors, drift tolerance (±1 window), rejection of
  malformed input.
- [`backup-codes.spec.ts`](../../apps/api/src/auth/mfa/domain/backup-codes.spec.ts) —
  alphabet, uniqueness within batch, normalization (strip dashes/spaces),
  hash+compare round-trip.
- [`mfa.service.spec.ts`](../../apps/api/src/auth/mfa/mfa.service.spec.ts) —
  every branch of `startEnrollment`, `confirmEnrollment`, `verifyStepUp`
  (TOTP + backup-code paths), `regenerateBackupCodes`, `disable`,
  `getStatus`, including throttler passthrough, encryption failures,
  and refresh-cookie coupling.
- [`mfa-verified.guard.spec.ts`](../../apps/api/src/auth/guards/mfa-verified.guard.spec.ts) —
  allow/block matrix over `@Public`, `@AllowUnverifiedMfa`,
  `@AllowMustChangePassword`, legacy tokens, and the negative case.
- [`mfa-enrollment.guard.spec.ts`](../../apps/api/src/auth/guards/mfa-enrollment.guard.spec.ts) —
  `MFA_ENFORCE_HR_ADMIN=false` disables the guard globally; regular
  employees are pass-through; HR/SA with `mfaEnabled=true` sail through.

E2E:

- [`mfa.spec.ts`](../../apps/e2e/tests/mfa.spec.ts) — API surface for
  enroll → confirm → status; login `mfaRequired=true` step-up;
  wrong-code, wrong-password, replayed-backup-code negatives;
  disable revokes refresh tokens; RBAC on anonymous callers.
- [`mfa-ui.spec.ts`](../../apps/e2e/tests/mfa-ui.spec.ts) — browser
  flows: voluntary enrollment from `/settings/security` (QR + backup
  reveal), login with TOTP, login with backup code, disable via UI
  (wrong password rejected + correct pair logs out), regenerate
  backup codes.
