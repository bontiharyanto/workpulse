# ADR-0038 — Vendor / Processor Register (Fase 31f)

* Status: Accepted
* Date: 2026-08-04
* Deciders: Workpulse Engineering + DPO
* Related: ADR-0034 (ROPA registry), ADR-0035 (DPIA), ADR-0037 (Retention audit + tenant usage)

## Context

UU 27/2022 Pelindungan Data Pribadi (PDP) Pasal 45 requires every
data controller (pengendali) to maintain a formal register of every
third-party data processor (pemroses) that touches personal data on
its behalf, including a Data Processing Agreement (DPA). GDPR Art.
28 imposes an equivalent obligation for tenants who serve or employ
EU data subjects.

Before Fase 31f, Workpulse tracked *what data it processes*
(`RopaActivity`, Fase 31d) and *the risks around that processing*
(`DpiaAssessment`, Fase 31e), but had no first-class registry for
*who else touches the data* — payroll vendors, S3 backups, email
providers, monitoring tools. This left three gaps:

1. **Compliance defect** — a regulator asking for the vendor
   register during a PDP audit would receive an ad-hoc spreadsheet.
2. **Operational blind spot** — nobody was systematically nudged
   when a DPA was approaching its yearly review or a contract was
   near expiry.
3. **ROPA completeness gap** — `RopaActivityVersion.recipients`
   was a free-form `string[]`, making it impossible to reason
   about which vendors were affected by a change in personal data
   flow.

Milestone 1 (compliance PDP) could not be declared complete until
this was fixed.

## Decision

Add a dedicated `VendorProcessor` model plus a `RopaActivityVendor`
join, expose CRUD + lifecycle endpoints under
`/admin/privacy/vendors`, and run a daily worker that sends DPO
reminders 30 days before every review cutoff and 60 days before
every contract expiry.

### Data model

* `VendorProcessor` — one row per third-party processor per tenant.
  Fields cover identity (name, slug, category), data footprint
  (dataCategories, volume, residency), contract (start/end,
  document URL, DPA signed date), review cadence (nextReviewAt,
  lastReviewedAt, lastReviewNote), and lifecycle (status,
  terminatedAt, terminatedReason).
* `RopaActivityVendor` — many-to-many join between `RopaActivity`
  and `VendorProcessor`. Optional `note` per link so tenants can
  annotate scope ("processes salary field only").
* `VendorReminderLog` — append-only dedup ledger for the daily
  worker. Unique `(vendorId, kind, expectedFor)` means a rescheduled
  cycle naturally re-fires the reminder.
* Three new enums: `VendorCategory`, `VendorStatus`,
  `VendorDataVolume`, plus `VendorReminderKind`.
* Two new `NotificationType` values: `VENDOR_REVIEW_DUE` and
  `VENDOR_CONTRACT_EXPIRING`.

### State machine

`VendorProcessor.status` follows a forward-only lifecycle enforced
by `canTransition()`:

    UNDER_REVIEW  →  ACTIVE            (DPA signed, vendor cleared)
    UNDER_REVIEW  →  TERMINATED        (negotiation walked)
    ACTIVE        →  DEPRECATED        (winding down)
    ACTIVE        →  TERMINATED        (contract ended cleanly)
    DEPRECATED    →  ACTIVE            (sunset reversed — rare)
    DEPRECATED    →  TERMINATED        (migration complete)
    TERMINATED    →  (terminal)

`ACTIVE` additionally requires `dpaSignedAt !== null` (`canBeActive`).
A re-signed vendor after termination MUST create a fresh row so the
historical audit chain survives.

### Reminder cadence

Pure functions in `vendor-review-cadence.ts` decide what fires today:

* `REVIEW_DUE` when `nextReviewAt <= now + 30d`. Severity crosses
  from `warning` to `critical` once overdue.
* `CONTRACT_EXPIRING` when `contractEndAt <= now + 60d`. 60d chosen
  because Indonesian corporate procurement cycles typically need
  45+ days from renewal decision to new PO issuance.
* `TERMINATED` and `DEPRECATED` vendors never trigger reminders.

The daily worker (`VendorReviewReminderWorker`, `@Cron('0 0 7 * * *')`)
scans, calls `computeDueReminders`, and inserts into
`VendorReminderLog` before dispatching notifications. The insert
races safely between replicas thanks to the unique index.

### Audit-before-write

All mutations write a matching `AuditLog` row inside the same
transaction as the state change (`VENDOR_PROCESSOR_CREATED`,
`_UPDATED`, `_STATUS_CHANGED`, `_REVIEWED`, `_TERMINATED`,
`_ROPA_LINKED`, `_ROPA_UNLINKED`). No update or delete on the audit
log itself.

### RBAC

`HR_MANAGER` and `SUPER_ADMIN` — same scope as ROPA / DPIA /
Breach Ledger. Everything filters by `actor.companyId` inside the
service.

### Kill switch

`VENDOR_REVIEW_REMINDER_WORKER_ENABLED` (default `true`). Follower
replicas set this to `false` so only the primary node fires
reminders. Surfaced by `/health/deep` alongside the other worker
flags.

## Alternatives considered

* **Store vendors as a JSON blob on `RopaActivityVersion`.** Rejected
  — no lifecycle, no reminder cadence, no query-ability, no reuse
  across activities.
* **Reuse `RopaActivityVersion.recipients` (free-form string tags).**
  Rejected — same three problems above. Kept the field as-is for
  backward compatibility but the vendor register is now the
  canonical source of processor identity.
* **Make `TERMINATED` reversible for "re-signed" vendors.** Rejected —
  breaks the audit chain (a regulator wants to see the *original*
  agreement plus a *new* row for the second signing, not a mutated
  history).
* **Send monthly digests instead of per-vendor alerts.** Rejected —
  a DPO investigating one vendor should be able to see one focused
  alert, not scan a digest for the relevant line.
* **Auto-terminate a vendor whose contract has expired.** Rejected —
  the DPO/HR must make the call, because the vendor may still hold
  data pending deletion. The worker escalates via `critical`
  severity instead.

## Positive consequences

* Milestone 1 (compliance PDP) is now materially complete: ROPA
  (31d), DPIA (31e), Vendor Register (31f), Breach Ledger (31g),
  Retention audit (OPS-6) all in place.
* A regulator asking "who processes this data on your behalf?" gets
  a queryable, versioned answer in seconds rather than hours.
* Contract renewals + review cycles are surfaced proactively — the
  DPO stops missing cutoffs.
* `AuditLog` gains a new provenance chain (`VENDOR_PROCESSOR_*`) so
  every change to a vendor is attributable.

## Negative consequences

* Two more tables + one more worker + two more notification types
  to keep an eye on. Kill switch documented but the cron cadence
  is fixed (daily 07:00 UTC).
* The DPA-signed precondition for `ACTIVE` is enforced at the
  service layer only. A rogue `UPDATE` bypassing the service would
  slip through — mitigated by RLS on `VendorProcessor` in the
  Postgres role for the app user.
* No PDF / XLSX export in this ADR. Kept for a follow-up (likely
  31h) so the wire shape stabilises first.

## Neutral consequences

* `RopaActivityVersion.recipients` is now redundant for tenants who
  fully migrate to the vendor register, but it stays for backward
  compatibility. A future migration may deprecate it once every
  active tenant has links.

## Rollback plan

* Set `VENDOR_REVIEW_REMINDER_WORKER_ENABLED=false` to silence
  reminders while leaving the CRUD surface intact.
* Full rollback: revoke migration `20260804000000_vendor_processor_register`,
  remove the `VendorProcessorModule` from `AppModule`, redeploy.
  Audit-log rows referencing `VENDOR_PROCESSOR_*` remain valid
  (soft references) — no cascade damage.

## Files touched

**API**

* `apps/api/prisma/schema.prisma` — 3 models, 4 enums, 2 notification types
* `apps/api/prisma/migrations/20260804000000_vendor_processor_register/migration.sql`
* `apps/api/src/vendor-processor/domain/vendor-review-cadence.ts` (+ spec)
* `apps/api/src/vendor-processor/vendor-processor.service.ts` (+ spec)
* `apps/api/src/vendor-processor/vendor-review-reminder.worker.ts` (+ spec)
* `apps/api/src/vendor-processor/vendor-processor.controller.ts`
* `apps/api/src/vendor-processor/vendor-processor.module.ts`
* `apps/api/src/vendor-processor/dto/vendor.dto.ts`
* `apps/api/src/notification/domain/templates.ts` — `vendorReviewDue`, `vendorContractExpiring`
* `apps/api/src/config/env.validation.ts` — `VENDOR_REVIEW_REMINDER_WORKER_ENABLED`
* `apps/api/src/health/health-deep.service.ts` — `vendorReviewReminder` flag
* `apps/api/src/app.module.ts`

**Shared types**

* `packages/shared-types/src/vendor.ts`
* `packages/shared-types/src/index.ts`
* `packages/shared-types/src/notification.ts`

**FE**

* `apps/web/app/(dashboard)/admin/privacy/vendors/page.tsx`
* `apps/web/app/(dashboard)/admin/privacy/vendors/[id]/page.tsx`
* `apps/web/app/(dashboard)/admin/privacy/vendors/new/page.tsx`
* `apps/web/components/features/privacy/vendor-processor-list.tsx`
* `apps/web/components/features/privacy/vendor-processor-detail.tsx`
* `apps/web/components/features/privacy/vendor-processor-create-form.tsx`
* `apps/web/components/features/settings/notification-preferences.tsx`
* `apps/web/app/(dashboard)/admin/_components/admin-subnav.tsx`
* `apps/web/lib/api-client.ts`

**Env / config**

* `.env.example`, `.env.production.example`

**Docs**

* `docs/WORKFLOW.md` — §19 Vendor / Processor Register
* `docs/ROADMAP.md` — 31f marked complete, Milestone 1 tutup
* `docs/ADR/ADR-0038-vendor-processor-register.md` (this file)
* `README.md` — feature status bump
