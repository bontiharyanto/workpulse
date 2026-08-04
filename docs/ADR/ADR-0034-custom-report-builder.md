# ADR-0034: Custom Report Builder (Fase 33b)

- Status: Accepted
- Date: 2026-08-03
- Deciders: Engineering
- Phase: 33b

## Context

Beyond the fixed reports shipped in 33c (Timesheet Summary, ROPA, DPIA,
Analytics Snapshot), HR / DPO users need to slice **existing HR data** by
their own axes — e.g. *"attendance on-time rate per department, last 30
days"* or *"overtime hours per user, last 90 days"* — without waiting
for an engineering ticket.

At the same time, we do NOT want:

- Free-form SQL exposed via HTTP (SQL injection, tenant leakage).
- A generic query engine that grows unbounded (unbounded surface = risk).
- New DB derivatives to maintain — we already have well-formed source
  tables (`AttendanceRecord`, `LeaveRequest`, `OvertimeRequest`,
  `Department`, `User`).

## Decision

Ship a **declarative, enum-driven** report builder:

- A **frozen catalogue** — 3 dimensions × 5 metrics × 4 windows.
- A **definition JSON** persisted as `SavedReport.definition` (JSONB).
- A **domain validator** (`validateDefinition`) that is the single
  security choke-point. Anything that reaches the query builder has
  already been validated against the catalogue.
- A **`ReportBuilderService`** composed of small `Prisma.sql` fragments,
  parameterised on the definition. Never string-concat user input.
- Integration with 33c: `ScheduledReportType.CUSTOM` references a
  `SavedReport.id`; the scheduler pulls the definition at dispatch time
  and emits CSV.

### Catalogue

| Axis | Values |
| --- | --- |
| Dimension | `DAY`, `DEPARTMENT`, `USER` |
| Metric | `ATTENDANCE_COUNT`, `ATTENDANCE_LATE_COUNT`, `ATTENDANCE_ON_TIME_RATE`, `LEAVE_DAYS_APPROVED`, `OVERTIME_HOURS` |
| Window | 7, 30, 90, 365 days |

Every combination is safe by construction — we own the SQL that
implements it.

### Data model

- `SavedReport` — tenant-scoped named report (unique per company by name).
- `definition` JSONB — validated on every write (`create`, `update`) and
  on every read that ends in execution (`preview`, `exportCsv`,
  `exportXlsx`, `scheduler dispatch`). Defence-in-depth against JSONB
  tampering.
- `createdById` is nullable to survive erasure workflows (Fase 31b).

### Execution

- `ReportBuilderService.execute(companyId, def)` dispatches by
  `metric`. Each branch produces a parametric SQL that:
  - Filters by `companyId` (tenant fence).
  - Filters by `filter.windowDays` (temporal fence).
  - Optionally filters by `filter.departmentId`.
  - Groups + labels by `dimension`.
- Rate metrics (`ATTENDANCE_ON_TIME_RATE`) are rounded to 4 decimals
  before returning.
- Returns `{ rows, totalRows, computedAt }`. `computedAt` is the query
  wall-clock — export files carry the same timestamp for audit.

### Export

- **CSV**: UTF-8 with BOM, CRLF line endings. Column order:
  `key,label,value`. Metric type is captured in the second header row
  as a comment. This is the format 33c emails.
- **XLSX**: bordered header, right-aligned value column, single sheet
  named after the report.

Both follow the **audit-before-stream** pattern: buffer entire payload,
hash SHA-256, `AuditLog.create` with `payloadSha256`, THEN stream the
bytes. Client sees `X-Payload-Sha256` for integrity verification.

### RBAC

- `HR_MANAGER` — full CRUD on saved reports, preview, export.
- `SUPER_ADMIN` — same, cross-tenant when explicitly required.
- All other roles — 403.

### Frontend

`/admin/reports/custom` provides:

- A saved-report list (load / rename / delete).
- A three-field builder (dimension, metric, window) that always
  matches the catalogue by design.
- A **Preview** button that hits the read-only preview endpoint.
- A **Save** action that persists the current definition.
- **Export CSV** and **Export XLSX** buttons on the currently loaded
  saved report.

## Alternatives Considered

1. **Free-form SQL editor** — rejected. Impossible to bound tenant
   isolation and injection risk in a reasonable time.
2. **Materialised views** — rejected for now. Adds ops load without
   clear win at current query volume.
3. **Third-party BI (Metabase / Superset)** — deferred. Considered for
   Fase 34+ when we need pivots + join graphs. Overkill for the "email
   me this slice weekly" use case.

## Consequences

- Positive: Zero-SQL surface for tenants; every report is auditable;
  scheduled emails inherit the same primitives; CSV/XLSX identical to
  ad-hoc.
- Negative: New dimension or metric requires a code change. Acceptable
  trade-off — expected to grow slowly and always under review.
- Risk: JSONB drift — mitigated by re-validating on every read that
  ends in execution.

## Rollback

Drop the `SavedReport` table + remove `CUSTOM` from
`ScheduledReportType` (or leave it inert). Nothing else references
saved reports outside this module.
