# ADR-0031 — Analytics: Executive KPI Dashboard (Fase 33a)

Status: Accepted
Date: 2026-08-03
Supersedes: —
Related: [ADR-0008](./ADR-0008-auto-absent-and-hr-dashboard.md), [ADR-0023](./ADR-0023-timesheet-foundation.md), [ADR-0025](./ADR-0025-timesheet-payroll-export.md)

## Context

HR + leadership need a single-page view of the operational health of
each tenant: on-time attendance rate, absent count, leave pipeline,
overtime cost, and headcount, updated at least daily. Running these
aggregates directly against `AttendanceRecord`, `LeaveRequest`,
`OvertimeRequest`, `AbsenceRecord`, and `User` at every dashboard page
load quickly becomes unfriendly to the primary DB — the tables are hot
paths for the transactional surface, and a 30-day rollup across
hundreds of employees for nine metrics is a lot of scanning per
click.

Fase 33a introduces a **materialised snapshot** table plus a small
read layer that combines historical snapshots with a live "today"
computation, giving the executive dashboard a bounded, cheap read path
without sacrificing intraday freshness.

## Decision

1. **One materialised table.** `AnalyticsSnapshot` stores exactly one
   row per `(companyId, date, metricKey)` with a `Decimal(18, 4)`
   value. The unique index doubles as the target of the nightly
   upsert, guaranteeing idempotent re-runs. The `dimension` JSONB
   column is reserved for future roll-ups (department, shift,
   leave-type) — the first release only writes company-wide roll-ups.

2. **Nine headline KPIs.** Codified in `AnalyticsMetricKey`
   (Postgres enum + Prisma enum + shared-types Zod enum, kept in
   lockstep):

   - `ATTENDANCE_ON_TIME_RATE` — fraction 0..1
   - `ATTENDANCE_LATE_COUNT`
   - `ATTENDANCE_ABSENT_COUNT`
   - `LEAVE_PENDING_COUNT`
   - `LEAVE_DAYS_APPROVED`
   - `OVERTIME_HOURS`
   - `OVERTIME_COST_IDR`
   - `HEADCOUNT_ACTIVE`
   - `HEADCOUNT_TERMINATED`

   The **metric descriptor catalogue**
   (`apps/api/src/analytics/domain/metric-keys.ts`) pins `label`,
   `description`, `formatKind` (`RATIO_PCT | COUNT | HOURS |
   CURRENCY_IDR`), `direction` (`HIGHER_IS_BETTER | LOWER_IS_BETTER |
   NEUTRAL`), and `fractionDigits`. The FE trusts the wire response's
   `formatKind` — never derives it from the metric name — so a rebrand
   never becomes a rendering bug.

3. **Nightly cron at 04:00 UTC.** After the retention worker (02:00
   UTC) and the timesheet scheduler (03:00 UTC), by design: the
   snapshot depends on those upstream effects being committed. Each
   tenant is projected to its own timezone, so **"yesterday" is
   yesterday in `Company.timezone`, not yesterday in UTC**. A single
   `ANALYTICS_SNAPSHOT_ENABLED=false` on follower replicas lets the
   primary run the sweep alone.

4. **Read path = snapshot + live today.** `AnalyticsQueryService`
   never trusts the snapshot for the current in-progress day. It
   reads `[from, yesterday-in-TZ]` from the table and computes today
   on-the-fly via `AnalyticsComputationService` — the same code the
   nightly worker uses, so there is zero risk of drift between
   materialised and live rows.

5. **Two endpoints.**
   - `GET /admin/analytics/dashboard?windowDays=7|30|90|365` — every
     tile with `currentValue`, `previousValue`, `delta` (absolute +
     percent + colour-safe `trend`), the window metadata, and the
     `lastComputedAt` marker.
   - `GET /admin/analytics/timeseries?metricKey=…&windowDays=…` — one
     densified point per calendar day, `isToday` flag on the live
     entry.

6. **Aggregation rules.** SUM for counts / hours / currency, AVG for
   the on-time ratio (each daily fraction weighted equally), LAST for
   headcount and pending-leave (point-in-time snapshots). Mapping is
   hard-coded in `AnalyticsQueryService.aggregationModeFor` — the FE
   never picks aggregation.

7. **RBAC + throttle.** `HR_MANAGER` + `SUPER_ADMIN` only; both
   endpoints throttled at 60/min so a stakeholder clicking through
   windows cannot DoS the DB. Every query filters by the actor's
   `companyId` inside the service, defence-in-depth against a future
   role-decorator regression.

## Alternatives considered

- **Compute every read on the fly.** Rejected — the sample tenant
  (~250 users, 30d window, 9 metrics) already scans ~65k
  `AttendanceRecord` rows plus similar volumes on Leave / Overtime
  per dashboard load; multiply by intraday refresh and the DB becomes
  the bottleneck instead of the app.

- **PostgreSQL materialised view (`CREATE MATERIALIZED VIEW`).**
  Rejected because refreshing them is either coarse (`REFRESH
  MATERIALIZED VIEW`) or requires trigger scaffolding per source
  table, and neither shape composes cleanly with the tenant-timezone
  requirement (materialised views are UTC-bound; carving them by
  local calendar day would double the row count).

- **Third-party OLAP (ClickHouse / DuckDB).** Rejected for MVP —
  extra ops burden for a single dashboard. The bar to earn a
  dedicated warehouse is significantly more than nine KPIs; when
  Fase 33b/c ship deeper analytics we will revisit.

- **Include today in the snapshot row.** Rejected — we would have to
  overwrite that row several times per day and coordinate across
  multi-node deployments. Splitting live-today from stored-history
  keeps writes strictly append-only-per-day and makes the retry
  story trivial (a re-run picks up yesterday cleanly).

- **Add `recharts` for the FE line chart.** Rejected — 40-60 KB
  gzipped for a single sparkline is a bad trade. `TrendChart`
  implements the tooltip + gradient area directly in SVG (~150 lines,
  zero deps). Revisit when we need stacked bars / brushes.

## Consequences

Positive:

- Executive dashboard reads scale with **rows returned**, not rows
  scanned. Adding a tenant is O(#days × #metrics) storage per year
  (~3300 rows / tenant / year).
- The **same computation module** runs on the cron and on the live
  "today" branch — one bug surface, one test surface.
- Adding a new metric is a **local change**: extend the Prisma enum,
  add a descriptor, implement the compute method, upsert. No new
  read-path plumbing.
- Tenant timezones are respected end-to-end — the 30-day tile for
  Jakarta reflects Jakarta days, not UTC days.

Negative:

- Backfilling a new metric requires a one-off admin action (a
  `POST /test-support/analytics/backfill` in dev; a dedicated
  ops script when we ship to production). Documented as a known
  operational tax in `docs/WORKFLOW.md § Analytics operations`.
- Snapshot rows accumulate forever unless a retention policy is
  added. Row width is small (~65 bytes) but we should revisit if a
  tenant exceeds ~5 years of daily rows without pruning.
- Prisma's `Decimal` strips trailing zeros on `.toString()`, so the
  wire format is a plain number (not a fixed-precision string).
  Callers doing byte-for-byte comparison must format via
  `formatValue()` in shared-types.

## Rollback

Purely additive:

```sql
DROP TABLE "AnalyticsSnapshot";
DROP TYPE  "AnalyticsMetricKey";
```

No other module reads from `AnalyticsSnapshot` — the dashboard
degrades gracefully to "empty" when the table is missing (React Query
will surface an error state).
