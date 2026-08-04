# ADR-0022 — Retention automation + consent tracking (Fase 31c)

- **Status:** Accepted
- **Date:** 2026-08-02
- **Deciders:** Principal Engineer (Workpulse Platform)

## Context

UU PDP §16(2)(g) and GDPR Article 5(1)(e) both bind processors to
retain personal data only "for as long as necessary for the purposes
for which it is processed". Fase 31a (DSAR) and 31b (right to
erasure) gave users on-demand access + deletion, but the platform
was still missing:

1. **Automated retention** — a routine sweep that ages out data no
   one has explicitly asked to delete but which is nevertheless
   past the tenant's stated retention window.
2. **Provable consent** — a durable, versioned ledger showing every
   user's acceptance of every privacy-policy version the tenant
   has published.

Multi-tenant deployments make this doubly interesting: two
customers of Workpulse can have wildly different retention needs
(a hospital keeps everything for a decade; a startup wants 90-day
turnover), and each must be able to publish its own policy in its
own language without touching the platform's shared codebase.

## Decision

### 1. Per-tenant `RetentionPolicy` (Prisma)

A single row per Company (unique constraint on `companyId`) with
three integer fields. Hard-coded safety bounds in
`RetentionService`:

| Field                             | Range  | Default | Zero-semantics       |
| --------------------------------- | ------ | ------- | -------------------- |
| `notificationRetentionDays`       | 0–730  | 90      | 0 → never prune      |
| `dataExportArchiveRetentionHours` | 1–168  | 24      | —                    |
| `terminatedUserAnonymizeDays`     | 0–3650 | 0       | 0 → auto-erasure off |

Reads lazily upsert the fallback row so a brand-new tenant sees
sensible defaults without a data-migration step.

### 2. `RetentionWorker` (`@Cron('0 0 2 * * *')`)

Runs once per day. For every non-soft-deleted Company it:

1. Deletes `Notification` rows older than
   `notificationRetentionDays`.
2. Scans `User` rows with `employmentStatus=TERMINATED` and
   `deletedAt < now - terminatedUserAnonymizeDays` and passes them
   to the shared `anonymizeUser` helper (identical semantics to
   Fase 31b — Attendance / Leave / Audit rows survive, PII is
   overwritten).

Each tenant sweeps inside its own transaction so a crash
mid-tenant leaves earlier tenants durably swept. A per-instance
kill switch (`RETENTION_WORKER_ENABLED=false`) lets multi-node
deploys run the worker on exactly one primary.

Data-export archive retention is enforced by the DSAR worker
(`DataExportWorker.retentionSweep`) reading the same tenant
value — we don't run two sweeps for the same data.

### 3. `PrivacyPolicy` + `UserConsent`

`PrivacyPolicy` — versioned tenant policies with a `(companyId,
version)` uniqueness constraint. The "currently active" row is
the row with the largest `effectiveAt <= NOW()` — future-dated
policies are staged but not exposed.

`UserConsent` — one row per `(user, policy)` acceptance,
append-only. `@@unique(userId, policyId)` prevents double-count
under concurrent submits. Captures `ip` + `userAgent` at
acceptance time as legally-relevant metadata.

### 4. `ConsentAcceptedGuard`

A global guard mirroring `MustChangePasswordGuard`:

- Fires on every authenticated route.
- Bypassed by `@Public()`, `@AllowMustChangePassword()`, and the
  new `@AllowPendingConsent()`.
- Returns `403 CONSENT_REQUIRED` with the pending policy id +
  version in `details` so the FE can force-route to `/consent`.

The guard order in `app.module.ts` places consent after
`MustChangePasswordGuard`, `MfaVerifiedGuard`, and
`MfaEnrollmentGuard` but before `RolesGuard` — a user stuck on
password rotation, MFA verify, or MFA enrollment still gets that
higher-priority redirect, and a wrong-role user is told they lack
permission rather than that they need to accept the policy.

### 5. `pendingConsent` on `AuthenticatedUserDto`

`GET /auth/me` and `POST /auth/login` return a `pendingConsent`
object (or `null`). The FE's `RequireAuth` reads it and force-
routes to `/consent`. That keeps the FE's redirect logic in a
single file and mirrors the existing `mustChangePassword` /
`mfaEnrollmentRequired` idiom.

### 6. Nullable `AuditLog.actorId`

Retention sweeps and other cron-driven mutations have no human
on the loop. To avoid impersonating a real user in the audit
trail, `AuditLog.actorId` is now nullable and the reader UI
renders `NULL` as "System". Human-triggered writes never leave
this null.

## Consequences

### Positive

- Tenants can dial retention independently, no re-deploy.
- Consent history is queryable per user, giving legal an
  export-ready proof-of-acceptance ledger.
- Auto-anonymisation closes the "employee left the company two
  years ago and their address is still in the DB" gap without
  requiring HR to file an erasure request manually.
- The `CONSENT_REQUIRED` guard makes the invariant impossible to
  bypass — even an admin who forgot to accept the policy they
  themselves published will be redirected.

### Negative / Trade-offs

- HR who publishes a new policy is now themselves gated by it.
  Documented behaviour, tested in the dup-409 E2E.
- Retention sweeps hold no advisory lock on tenant scoping, so
  two racing operators could still mutate `RetentionPolicy` mid-
  sweep. Acceptable — the worker reads once per tick and every
  action is idempotent.
- Auto-anonymisation is a destructive operation. We considered
  gating it behind an admin approval workflow (like Fase 31b)
  but decided against it — the point of the retention automation
  is precisely to avoid manual review.

### Rejected alternatives

- **Store retention config on the `Company` row.** Rejected —
  would balloon that already-fat model, and we anticipate more
  retention knobs (audit-log retention, session-token retention)
  in later phases.
- **Enforce consent inside `JwtAuthGuard`.** Rejected — mixes
  authentication with a business-rule check and makes the code
  path for anonymous callers slower.
- **Store consent acceptance as a boolean column on `User`.**
  Rejected — you cannot prove _when_ the user accepted _which_
  version. A ledger with `ip` + `userAgent` per row is what
  legal actually needs.

## Related

- ADR-0020 — DSAR (Fase 31a).
- ADR-0021 — Right to erasure (Fase 31b).
