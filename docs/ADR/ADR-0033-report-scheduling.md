# ADR-0033: Scheduled Email Reports

- Status: Accepted
- Date: 2026-08-03
- Deciders: Engineering
- Phase: 33c

## Context

Ops teams (payroll, DPO, finance) want scheduled emails with the same
PDF reports we already surface via the admin dashboards. Common ask
was _"send me the timesheet summary every Monday 06:00 UTC"_ and
_"forward the latest ROPA snapshot to the DPO monthly"_.

Before 33c there was no ergonomic way to deliver these — one-off
exports live behind a login-gated admin console, and vendors kept
asking us to email PDFs on a fixed cadence.

## Decision

Ship a first-class **ReportSchedule** subsystem alongside the existing
report producers (ROPA, DPIA, Analytics, Timesheet). Every schedule:

- Binds a **built-in `reportType`** (5 enum values). Custom reports
  (`CUSTOM`) are reserved for Fase 33b's saved-report definitions.
- Has a **cadence** — DAILY, WEEKLY (with `cadenceDay` 0..6), or
  MONTHLY (with `cadenceDay` 1..28). Days are UTC per DB storage;
  the FE picker projects local time before submitting.
- Has an **hour-of-day** (UTC) — no minute granularity because the
  cron ticks every 15 minutes.
- Has a **recipient list** — 1..20 email addresses, deduped
  case-insensitively before storage.
- Advances `nextRunAt` after each dispatch via the pure `advance()`
  domain function.

### Data model

- `ReportSchedule` — subscription row.
- `ReportDelivery` — append-only log; each row captures status,
  attempts, payload SHA-256, byte length, error snippet, delivered-at.

**Delivery table is not fully immutable** — the worker transitions
status (`DISPATCHING → DELIVERED / FAILED`) via UPDATE. But we
`REVOKE DELETE ON "ReportDelivery" FROM PUBLIC` in the migration so
the audit trail cannot be gapped.

### Worker

- Cron ticks every 15 min (`0 */15 * * * *`).
- Claims up to 20 due schedules using `SELECT … FOR UPDATE SKIP LOCKED`
  and pushes their `nextRunAt` forward by 15 minutes as a "hold token"
  before releasing the row-lock. This prevents peer replicas from
  double-claiming during the render window.
- Per-claim: render → hash → email.send (with attachment) → log outcome.
- A poison-pill schedule (render throws, missing recipients, etc.)
  yields a `FAILED` delivery row but does not block neighbours.

### Email adapter change

The `EmailAdapter` interface grew an optional `attachments` field so
the SMTP adapter can pass the PDF through nodemailer. Existing
notification templates never set the field — 100% backwards-compatible
with previous adapters.

### RBAC + throttling

- `HR_MANAGER` + `SUPER_ADMIN` only.
- Mutations 15..30/min, reads unthrottled.
- Every mutation writes an `AuditLog` row inside the same `$transaction`.

## Alternatives Considered

**Signed download link in the email body instead of an attachment** —
better security posture (no PDF in inbox), but blocks recipients who
sit behind IP-locked corporate networks and asymmetric with the
existing timesheet-share flow. Deferred; if we ever need it, the
`ReportDelivery` row already carries the payload hash.

**BullMQ / Redis queue for retries** — overkill for 20 rows every 15
min. Postgres + SKIP LOCKED handles single-digit RPS with headroom
for years.

**Extend `NotificationService` to enqueue "email + attachment"** —
tried; rejected. Notification queue is optimised for lots of small
in-app pings, not a handful of large-PDF dispatches per day. Keeping
scheduler + notification as siblings avoids a fanout hot-path.

## Consequences

### Positive

- Fully self-serve HR workflow — no cron scripts, no `crontab -e`.
- Delivery log is durable, auditable, and hashed.
- 4 built-in report types cover today's demand; `CUSTOM` slot ready
  for 33b's saved reports.

### Negative

- Attachments risk mail-gateway rejection (>10 MB). We don't limit
  payload size in code — the PDF renderers are small by design (all
  <500 KB in practice) so we trade the guard for simplicity.
- No UI to preview the PDF before creating a schedule — DPO must
  create + dispatch to verify. Follow-up idea (33c.1).

## Rollback

Feature is additive:

- Disable via `REPORT_SCHEDULER_ENABLED=false` (follower replicas
  already run in this mode).
- `DROP TABLE "ReportDelivery", "ReportSchedule";`
- `DROP TYPE "ReportDeliveryStatus", "ReportFrequency", "ScheduledReportType";`
- Remove `apps/api/src/reports/**` + FE at `/admin/reports/schedules`.

## References

- ADR-0028 (Timesheet share) — signed download link idiom (chosen not
  to reuse here; see alternatives).
- ADR-0031 (Analytics) — worker pattern (cron + snapshot) mirrored
  here.
