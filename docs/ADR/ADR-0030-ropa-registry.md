# ADR-0030 — ROPA Registry (Fase 31d)

Status: Accepted
Date: 2026-08-03
Supersedes: —
Related: [ADR-0020](./ADR-0020-data-export-dsar.md), [ADR-0021](./ADR-0021-right-to-erasure.md), [ADR-0022](./ADR-0022-retention-and-consent.md)

## Context

Both **UU 27/2022 Pelindungan Data Pribadi Pasal 31** and **GDPR Art. 30**
require every controller to maintain a **Record of Processing Activities**
(ROPA): a living register describing _what_ personal data is processed,
_why_, on _what_ legal basis, _who_ it is shared with, and _how long_
it is retained. When a regulator inspects the tenant, the ROPA is the
first artefact they ask to see.

Before this ADR the operator had to keep the register in a spreadsheet
outside the app — a workflow that (a) drifts silently when the product
changes, (b) has no audit trail, (c) offers no way to prove an entry
existed at a specific moment in time, and (d) cannot be exported in a
tamper-evident format.

Fase 31d closes that gap.

## Decision

Ship a first-class ROPA registry inside Workpulse, with:

1. **Two tables.** `RopaActivity` is a stable per-tenant handle (one row
   per named processing activity, uniquely keyed by `slug`). Every
   substantive change creates a new **immutable** `RopaActivityVersion`
   snapshot. `RopaActivity.currentVersionId` points at the active
   `PUBLISHED` version and is `UNIQUE` in Postgres to prevent
   split-brain during a concurrent publish.

2. **Versioned lifecycle.** `DRAFT → REVIEW → PUBLISHED → ARCHIVED`,
   consistent with the `PrivacyPolicy` workflow shipped in ADR-0022.
   Publishing a new version auto-archives the previous `PUBLISHED` inside
   the same `$transaction`. This mirrors the state machine that DPOs
   already know from the privacy policy surface.

3. **Six seed blueprints** (`apps/api/src/ropa/domain/seed-catalogue.ts`)
   materialised via a **manual** `POST /admin/ropa/seed-defaults` button.
   The blueprints are deliberately conservative _drafts_ — the DPO must
   review before publish, because a regulator would reject "generic
   default" wording. Rerunning the helper is idempotent: existing slugs
   are skipped, missing ones created. The seed covers every built-in
   Workpulse module that touches personal data:

   - `attendance-tracking`
   - `leave-management`
   - `overtime-management`
   - `timesheet-and-payroll-export`
   - `authentication-and-mfa`
   - `outbound-webhook-delivery`

4. **RBAC.** All endpoints under `/admin/ropa/*` require
   `HR_MANAGER` **or** `SUPER_ADMIN`. Every mutating action writes an
   `AuditLog` row inside the same transaction: `ROPA_VERSION_CREATED`,
   `ROPA_VERSION_UPDATED`, `ROPA_VERSION_SUBMITTED`,
   `ROPA_VERSION_RETURNED`, `ROPA_VERSION_PUBLISHED`,
   `ROPA_VERSION_ARCHIVED`, `ROPA_EXPORTED`.

5. **Exports.**
   - `GET /admin/ropa/export.pdf` — human-readable regulator PDF, one
     section per activity (via `pdfkit`).
   - `GET /admin/ropa/export.xlsx` — machine-readable XLSX with a
     **frozen column order** (15 columns; see
     `renderers/ropa-xlsx-renderer.ts`) so DPOs can pipe it into their
     own compliance tooling.

   Both formats share the **audit-before-stream** pattern first
   documented in ADR-0025 (payroll export): the SHA-256 of the payload
   is written to `AuditLog.afterJson.sha256` **before** any bytes leave
   the process. The same hash is also returned as
   `X-Payload-Sha256`, so a DPO can screenshot the header alongside the
   audit row for regulator-facing evidence.

6. **Editable window.** Only `DRAFT` versions accept `PATCH`; the state
   machine guard (`isEditable`) is enforced both in the pure domain code
   (unit-tested) and inside `RopaRegistryService.patchVersion` (409
   `ROPA_NOT_EDITABLE`). Publishing from `DRAFT` is refused (must go
   through `REVIEW`) so the two-step gate cannot be bypassed.

## Alternatives considered

- **Auto-publish seed defaults.** Rejected — regulators explicitly warn
  against boilerplate ROPA entries; a fresh tenant publishing generic
  wording would fail an audit. Requiring a DPO to review each seed
  before publish is the whole point of shipping them as `DRAFT`.

- **Single mutable "current" record per activity, plus a shadow
  history table.** Rejected because it split the source of truth from
  the audit trail: reads for the current row bypassed the history table
  and admins would eventually convince themselves the shadow table was
  "just for audit". Versioning as first-class rows means every reader
  goes through the same lifecycle, and PUBLISHED remains queryable as
  regular data.

- **DPIA in the same migration.** Deferred to Fase 31e. DPIA has a
  different lifecycle (mitigation register + residual-risk scoring) and
  merging them into 31d would ship half of each. The ADR line stays
  clean if 31e supersedes an alternative here rather than modifying
  31d in-place.

- **Deep type-level enum for `dataCategories` / `subjectCategories`.**
  Rejected in this iteration because tenant vocabularies vary
  (Indonesian labour law categories vs GDPR "special categories" vs
  vendor-specific tags). Ship free-form strings with a suggested tag
  set (`ROPA_DATA_CATEGORIES` in `shared-types`) and revisit if the FE
  autocomplete tooling ever needs a stricter model.

## Consequences

Positive:

- DPO / HR gets a **compliant, auditable ROPA out of the box** — no
  more parallel spreadsheet drift.
- The version model unlocks **year-over-year comparison** ("what did
  we tell the regulator in 2025 vs 2026?") without extra tooling.
- Every export is **cryptographically pinned** via the SHA-256 audit
  row, so the tenant can defend against "we never received that PDF"
  claims from an auditor.

Negative:

- One more admin surface to keep in sync with product changes. New
  personal-data flows require an ADR reminder to update seed blueprints
  (or add a new blueprint) — noted in the PR checklist in
  `.cursor/rules/60-repo-and-docs-standards.mdc`.
- DPIA is missing until Fase 31e; the FE dashboard needs to explicitly
  say "ROPA only" so DPOs don't assume this ships risk assessments.

## Rollback

Both tables are additive. Rolling back is a `DROP TABLE
RopaActivityVersion; DROP TABLE RopaActivity;` plus dropping the two
enums (`RopaVersionStatus`, `RopaLegalBasis`). No other module depends
on ROPA rows — the export endpoints are self-contained inside
`apps/api/src/ropa/`.
