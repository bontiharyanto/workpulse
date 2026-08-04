# ADR-0019 — Real Email Transport (SMTP) & Security Headers Audit

- **Status**: Accepted
- **Date**: 2026-08-02
- **Authors**: Workpulse Platform
- **Supersedes / Related**: [ADR-0006 (Notification strategy)](./ADR-0006-notification-strategy.md), [ADR-0002 (Auth & Sessions)](./ADR-0002-auth-strategy.md)

## Context

Two rough edges from previous phases were still pending at the start
of Fase 30c:

1. **Email delivery was fake.** `EMAIL_TRANSPORT=smtp` was declared in
   the env schema but silently downgraded to `console` at runtime
   because no real SMTP adapter shipped. This blocked production
   deployment of password-reset, leave-approval, and overtime-decision
   emails.

2. **Security headers were the Helmet defaults.** Fine for MVP, but
   the API exposed `x-frame-options: SAMEORIGIN` (should be `DENY` —
   we never intend to be framed) and shipped a permissive CSP with
   `script-src 'self'` even though the API serves only JSON + Swagger.
   The Next.js frontend shipped **zero** custom headers — no CSP, no
   Permissions-Policy, no HSTS in prod.

## Decision

Two independent tracks, sharing the same phase because they touch the
same deployment envelope:

### Track A — SMTP email adapter

Wire `nodemailer` as the concrete implementation of `EmailAdapter` for
`EMAIL_TRANSPORT=smtp`. Every reputable provider (Amazon SES,
SendGrid, Mailgun, Postmark, Google Workspace) ships an SMTP endpoint,
so a single adapter covers them all — no vendor lock-in.

- New file [`smtp-email-adapter.ts`](../../apps/api/src/notification/email/smtp-email-adapter.ts).
- Factory branching is extracted into
  [`pick-email-adapter.ts`](../../apps/api/src/notification/email/pick-email-adapter.ts)
  so the switch itself is unit-testable without spinning the full Nest
  graph.
- Env validation `superRefine` now rejects `EMAIL_TRANSPORT=smtp`
  without `SMTP_HOST` / `SMTP_PORT`, and rejects any transport other
  than `smtp` when `NODE_ENV=production`.

Failure semantics preserve the existing "email failures must NEVER
roll back a business transaction" contract from
[ADR-0006](./ADR-0006-notification-strategy.md): `send()` catches every
error, logs a `WARN`, and returns. `verify()` at boot is opt-in via
`SMTP_VERIFY_ON_BOOT=true` so a provider glitch cannot delay every
fresh deploy.

### Track B — Security headers audit

**API (`apps/api/src/main.ts`):**

- Tighten Helmet CSP: `default-src 'self'`, `frame-ancestors 'none'`,
  `object-src 'none'`, no `unsafe-inline` in `script-src`. In non-prod
  we relax `connect-src` via `API_CSP_EXTRA_ORIGINS` so an operator
  can point Swagger at a CDN without forking main.
- `xFrameOptions: DENY` (was `SAMEORIGIN`).
- `referrerPolicy: no-referrer` (was default `no-referrer` — kept
  explicit for auditability).
- `strictTransportSecurity` only in production. When `HSTS_PRELOAD=true`
  we bump `max-age` to 2 years and add `preload` — irreversible in the
  browser-side preload list; opt-in for that reason.

**Web (`apps/web`):**

- New `middleware.ts` emits a per-request CSP with a fresh 128-bit
  nonce. `strict-dynamic` lets Next's server-inlined bootstrap scripts
  hydrate without a host allowlist while still refusing every other
  inline script. Dev mode also allows `'unsafe-eval'` because Next's
  HMR runtime evaluates code strings; production drops it.
- `next.config.mjs` adds static headers via `async headers()`:
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy` locked down (no camera / mic / usb / …),
  `Strict-Transport-Security` in production, `X-Content-Type-Options: nosniff`.
  `Permissions-Policy` keeps `geolocation=(self)` alive so the
  `/attendance` clock-in flow still works.
- The middleware matcher explicitly skips `/_next/static`,
  `/_next/image`, favicon, and every static asset extension so we do
  not spend crypto RNG on every avatar request.

## Wire contract

The concrete headers on a fresh production build:

```
API (any route):
  content-security-policy: default-src 'self'; base-uri 'self';
                           frame-ancestors 'none'; object-src 'none';
                           script-src 'self'; style-src 'self' 'unsafe-inline';
                           connect-src 'self'; upgrade-insecure-requests;
  strict-transport-security: max-age=15552000; includeSubDomains
  x-frame-options: DENY
  referrer-policy: no-referrer
  x-content-type-options: nosniff

Web (HTML pages):
  content-security-policy: default-src 'self';
                           script-src 'nonce-<random>' 'strict-dynamic';
                           style-src 'self' 'unsafe-inline';
                           frame-ancestors 'none'; …
  permissions-policy: camera=(), microphone=(), geolocation=(self), …
  strict-transport-security: max-age=15552000; includeSubDomains
  x-frame-options: DENY
```

## Design highlights

- **Adapter pattern is preserved.** `EmailAdapter` remains the only
  interface that `NotificationService` knows about; adding SES-specific
  behaviour later (e.g. suppression-list checks) is a new adapter, not
  a fork of the service layer.

- **`transporter.close()` on module destroy.** Nodemailer's pool mode
  keeps connections open; a hot reload during `pnpm dev` would leak
  file descriptors without the explicit close.

- **Env-driven kill switch for HSTS preload.** Preload is opt-in
  because it is a **one-way** commitment: once a domain is in the
  Chromium / Firefox / Safari preload list, browsers refuse HTTP for
  that domain for years. Requires the ops team to positively confirm
  every subdomain speaks HTTPS.

- **CSP nonce, not `unsafe-inline`.** Next.js still needs its
  bootstrap script; `'nonce-<rand>'` + `'strict-dynamic'` is the modern
  best-practice — the nonce is unpredictable per request, and
  `strict-dynamic` lets the nonce-loaded script transitively load
  child scripts without extending the allowlist.

- **`style-src 'unsafe-inline'` is intentional.** Tailwind and Next
  both emit small inline `<style>` blocks; tightening this needs a
  hash-based build pipeline that we deferred.

## Trade-offs & alternatives considered

- **Direct AWS SES SDK adapter (instead of nodemailer + SES SMTP).**
  Rejected for MVP — SES-over-SMTP works, adds no new AWS dependency,
  and keeps the door open for non-SES providers. A dedicated
  `SesEmailAdapter` can slot in later if we need SES-specific features
  (bounce webhooks, suppression list APIs).

- **Report-only CSP (`Content-Security-Policy-Report-Only`).**
  Considered for a rollout period. Skipped because the app is
  greenfield — no third-party embed depends on the current relaxed
  policy, so a hard cutover is safe. Report-only can be layered later
  when we introduce a report endpoint.

- **Full CSP hash pipeline for inline styles.** Would let us drop
  `'unsafe-inline'` from `style-src`. Deferred — the return on
  investment is low compared to the build-time complexity (Tailwind
  emits new hashes every build).

- **Central shared middleware for both API and web.** The two runtimes
  are wildly different (Express + Helmet vs Edge middleware). A shared
  library would abstract at the wrong seam. We keep them separate but
  aligned via this ADR + the security-headers E2E smoke test.

## Ops / rollout

- **Deploy order**: web first (adds the FE headers), API second (adds
  the tightened Helmet). Order does not matter for correctness — the
  two apps are decoupled — but sequencing new CSPs one at a time
  makes rollback simpler.
- **New env vars**: `SMTP_VERIFY_ON_BOOT`, `API_CSP_EXTRA_ORIGINS`,
  `HSTS_PRELOAD`. All optional with safe defaults; documented in
  [`.env.example`](../../.env.example).
- **Production check-list**: set `EMAIL_TRANSPORT=smtp`, populate the
  four `SMTP_*` vars, decide `HSTS_PRELOAD` (default `false`; flip
  only after confirming every subdomain speaks HTTPS).

## Verification

- **Unit** — [`smtp-email-adapter.spec.ts`](../../apps/api/src/notification/email/smtp-email-adapter.spec.ts)
  covers 7 cases (send happy path, throw-swallow, optional auth,
  transporter close, opt-in verify + swallow). [`pick-email-adapter.spec.ts`](../../apps/api/src/notification/email/pick-email-adapter.spec.ts)
  exhausts the factory branching with 5 cases.
- **E2E** — [`security-headers.spec.ts`](../../apps/e2e/tests/security-headers.spec.ts)
  asserts the CSP shape, absence of `unsafe-inline` in `script-src`,
  and per-request nonce rotation on the web app.
- Full API unit suite: **742 pass** (+12 from Fase 30b).
- Full E2E: **129 pass** (+3 from Fase 30b).
