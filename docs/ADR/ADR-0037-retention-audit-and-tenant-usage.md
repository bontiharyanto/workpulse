# ADR-0037 — Retention Enforcement Audit & Tenant Usage Instrumentation (OPS-6 + OPS-7)

- **Status**: Accepted
- **Date**: 2026-08-03
- **Related**:
  - [ADR-0022 — Retention & consent](./ADR-0022-retention-and-consent.md)
  - [ADR-0027 — Outbound webhooks](./ADR-0027-outbound-webhooks.md)
  - [ADR-0036 — Beta launch ops baseline](./ADR-0036-beta-launch-ops-baseline.md)

## Context

The Beta / soft-launch package (ADR-0036) shipped the operational
foundation but explicitly deferred two Milestone 6 items:

- **OPS-6 — Retention enforcement audit**. The retention worker
  (Fase 31c) is scheduled but has no monthly attestation that it
  actually did the pruning promised by the tenant's
  `RetentionPolicy`. If the kill switch is left off for a month, or
  a rare bug drops the tick, nobody notices until the DPO asks
  "prove you deleted last quarter's notifications".
- **OPS-7 — Cost / usage instrumentation**. We ship an enterprise
  product but have no per-tenant footprint measurement — storage
  bytes, DB row counts, email + webhook volume, active users. This
  blocks two things: (1) capacity planning for the next tenant, and
  (2) future billing tier that isn't just a flat fee.

Both are low-risk, small-footprint additions ("effort S") so the
right move is to close them out together and mark Milestone 6 done.

## Decision

Two new domain modules landing in a single migration:

### 1. `RetentionAuditReport` — monthly attestation

```
company (Company)
  ↓
RetentionAuditReport
  - status: SUCCESS | GAP_DETECTED | WORKER_INACTIVE
  - counters (from AuditLog aggregate + live table probes)
  - findings JSONB (typed, severity-tagged)
  - policySnapshot JSONB (frozen at generation time)
```

- **Populated by** `RetentionAuditWorker` cron on day 1 of every
  month at 05:30 UTC — 3h30m after the daily retention sweep at
  02:00 UTC, giving that worker time to catch up.
- **Read at** `/admin/privacy/retention/audit-reports` (HR_MANAGER +
  SUPER_ADMIN). Timeline card per month with status chip, counters,
  findings breakdown, and policy snapshot side-by-side.
- **Regenerated** on-demand via `POST /regenerate` (SUPER_ADMIN
  escape hatch — after policy fix, or post-mortem of a worker bug).
  Manual regen does NOT re-notify to avoid alert spam.
- **Notifies** all HR_MANAGER + SUPER_ADMIN of the tenant via a
  new `RETENTION_AUDIT_GAP_DETECTED` notification type when the
  report status is anything other than `SUCCESS`. Delivered in-app
  + email through the standard `NotificationService` pipeline —
  user preferences apply.
- **Gap detection** is a pure function
  (`retention-audit-findings.ts`) so it can be tested independently
  of Prisma.

### 2. `TenantUsageSnapshot` — monthly footprint

```
company (Company)
  ↓
TenantUsageSnapshot
  - storage bytes (BigInt): export + DSAR archive, total
  - db row counts per major table + total
  - notificationsCreated, webhookDeliveries (period-scoped)
  - activeUsers (distinct userIds in period) + totalUsers
```

- **Populated by** `TenantUsageWorker` cron on day 1 of every month
  at 06:00 UTC (30 min after the retention audit).
- **Read at** `/admin/usage` — HR_MANAGER sees only their tenant,
  SUPER_ADMIN sees a cross-tenant table + can regenerate any month
  for any tenant.
- **Storage counting** is DB-derived only:
  - `TimesheetExport.bytes` for exports committed in the period.
  - `DataExportRequest.fileSize` for DSAR archives completed in the
    period.
  - **Attachment file sizes are NOT tracked** — the schema has
    `attachmentUrl` strings but no bytes column. The snapshot flags
    `attachmentBytesTracked=false` so consumers know the total is
    an under-estimate. Post-Beta will introduce a dedicated
    `Attachment` model with `contentLength`.
- **BigInt transport**: storage / db-total values cross JSON as
  stringified integers (`"12345678"`) so a mature tenant does not
  silently lose precision at 2^53.

### 3. Shared design decisions

- **Idempotent generation** — `upsert` on the composite
  `(companyId, periodStart)` unique index so cron re-runs are
  safe. Regenerate overwrites derived counters + the `findings`
  payload; snapshotting historical data is guaranteed by the DB
  copy, not by app-level append-only discipline.
- **Policy snapshot frozen** in `RetentionAuditReport.policySnapshot`
  so re-runs after a policy change are reproducible.
- **Two kill switches** — `RETENTION_AUDIT_WORKER_ENABLED` and
  `TENANT_USAGE_WORKER_ENABLED`, default `true`. Set to `false` on
  follower replicas so only the primary runs the monthly work.
- **RBAC** — HR_MANAGER for their tenant, SUPER_ADMIN for
  cross-tenant regenerate. No employee-level exposure of either.

## Alternatives considered

- **Direct AuditLog SELECT for OPS-6** — reading raw `AuditLog`
  every time the DPO asks. Rejected: it forces the DPO to write SQL,
  makes gap detection ad-hoc, and provides no snapshot against
  forensic drift (backup restore, tenant purge).
- **CloudWatch / prometheus metrics for OPS-7** — piping counters
  out to a monitoring stack. Rejected for Beta: the pilot deployment
  is single-VPS + docker-compose (ADR-0036), so a heavyweight
  metrics pipeline is overkill. A Prisma table is grep-able and
  survives a redeploy of the observability stack.
- **Full ListObjectsV2 sweep for storage counts** — walking the S3
  bucket per tenant per month. Rejected: slow, expensive, and
  requires a per-tenant path convention we don't have yet.
  DB-derived is fast + honest — the gap is documented via
  `attachmentBytesTracked=false`.
- **Materialised view for `TenantUsageSnapshot`** — could refresh
  a Postgres MATERIALIZED VIEW nightly. Rejected: the query is
  hetero-source (`TimesheetExport.bytes` + `DataExportRequest.fileSize`
  + `COUNT(*)` across ~10 tables), and Prisma model gives us the
  API surface for free.

## Consequences

### Positive

- DPO can produce a "the worker did its job" report on demand.
- Ops has real per-tenant footprint numbers before onboarding
  tenant N+1.
- Cross-tenant table becomes the natural place to add a "cost per
  tenant" column when the billing tier lands.
- Both features hook into existing infrastructure (`NotificationService`,
  `AuditLog`, `RetentionPolicy`) — no new external dependencies.

### Negative

- Every tenant grows two rows per month forever. At 100 tenants x
  60 months that's 12,000 rows total — negligible.
- Attachment bytes remain untracked until the follow-up model
  lands post-Beta. Snapshot is honest about the gap via
  `attachmentBytesTracked=false` but consumers must not treat
  `storageTotalBytes` as an exhaustive number.
- The monthly cron adds two new failure modes (worker crash on day
  1 = missing report; DPO email fanout backpressure). Both are
  guarded by kill switches and normal Nest logging.

### Neutral

- Timezone: all period math uses UTC. A pilot in Asia/Jakarta will
  see report periods that don't align to Jakarta calendar-month
  boundaries. Acceptable for a monthly attestation — refactoring
  to per-tenant timezone can wait until a customer asks.

## New files

```
apps/api/prisma/migrations/20260803300000_ops_retention_audit_and_usage/migration.sql
apps/api/src/retention/domain/retention-audit-findings.ts
apps/api/src/retention/domain/retention-audit-findings.spec.ts
apps/api/src/retention/dto/retention-audit.dto.ts
apps/api/src/retention/retention-audit.service.ts
apps/api/src/retention/retention-audit.service.spec.ts
apps/api/src/retention/retention-audit.controller.ts
apps/api/src/retention/retention-audit.worker.ts
apps/api/src/tenant-usage/domain/usage-calculator.ts
apps/api/src/tenant-usage/domain/usage-calculator.spec.ts
apps/api/src/tenant-usage/dto/tenant-usage.dto.ts
apps/api/src/tenant-usage/tenant-usage.service.ts
apps/api/src/tenant-usage/tenant-usage.controller.ts
apps/api/src/tenant-usage/tenant-usage.worker.ts
apps/api/src/tenant-usage/tenant-usage.module.ts
apps/web/app/(dashboard)/admin/privacy/retention/audit-reports/page.tsx
apps/web/app/(dashboard)/admin/privacy/retention/audit-reports/[id]/page.tsx
apps/web/app/(dashboard)/admin/usage/page.tsx
apps/web/components/features/privacy/retention-audit-reports-panel.tsx
apps/web/components/features/privacy/retention-audit-report-detail.tsx
apps/web/components/features/admin/tenant-usage-panel.tsx
packages/shared-types/src/tenant-usage.ts
```

## Modified files

```
apps/api/prisma/schema.prisma                              — RetentionAuditReport + TenantUsageSnapshot + enum
apps/api/src/retention/retention.module.ts                 — wire audit service + worker + controller
apps/api/src/notification/domain/templates.ts              — retentionAuditGap() template
apps/api/src/config/env.validation.ts                      — two new kill-switch envs
apps/api/src/health/health-deep.service.ts                 — surface both workers in /health/deep
apps/api/src/app.module.ts                                 — register TenantUsageModule
apps/web/lib/api-client.ts                                 — retentionAuditApi + tenantUsageApi
apps/web/app/(dashboard)/admin/privacy/retention/page.tsx  — cross-link to /audit-reports
apps/web/components/features/settings/notification-preferences.tsx — RETENTION_AUDIT_GAP_DETECTED entry
packages/shared-types/src/retention.ts                     — audit types added
packages/shared-types/src/notification.ts                  — RETENTION_AUDIT_GAP_DETECTED enum
packages/shared-types/src/index.ts                         — tenant-usage export
.env.example + .env.production.example                     — new envs documented
```
