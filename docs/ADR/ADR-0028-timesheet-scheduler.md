# ADR-0028 — Timesheet auto-generation & reminder scheduler (Fase 32f)

Status: **Accepted** — 2026-08-03

## Context

Fase 32a–32e delivered the timesheet lifecycle end to end: config →
generate → submit → approve → export → share → outbound webhook.
Every step was still **operator-initiated**: HR clicks "Generate" at
the start of a period, employees remember to submit, supervisors and
HR remember to check the queue. Real-world tenants told us this
manual cadence rots after 2-3 months — periods get skipped, queues
accumulate stale rows, payroll runs late.

We need a **background scheduler** that:

1. Auto-generates the next timesheet period the moment the current
   one closes (no more "HR forgot to click Generate").
2. Nudges employees who haven't submitted yet.
3. Nudges approvers (Supervisor, HR) who have a queue.

Everything else about the workflow stays as-is; the scheduler is
purely additive.

## Decision

### 1. Cadence: daily UTC cron, 03:00

Single Nest `@Cron('0 0 3 * * *')` job, same posture as the
retention worker. For Asia/Jakarta (UTC+7) this lands at 10:00 local
during the workday. Multi-region tenants have not been requested yet;
when they are, we'll add per-tenant dispatch hours as a follow-up
config field — the current architecture localizes tenant TZ inside
`sweepOneTenant`, so that change is confined.

**Rejected alternatives:**

- **Hourly cron gated by local hour**: adds a moving target and DST
  edge cases without solving a problem we have.
- **Per-tenant cron**: N crons × M tenants is operationally
  brittle; we prefer one cron doing per-tenant sweeps sequentially.

### 2. Per-tenant configuration

The scheduler is opt-out at the tenant level. Fields extended on
`TimesheetConfig` (all default sensible):

| Field | Type | Default | Purpose |
|---|---|---|---|
| `autoGenerateEnabled` | bool | `true` | Master switch for period auto-creation |
| `reminderEnabled` | bool | `true` | Master switch for reminder notifications |
| `submitReminderStartDays` | int 0..30 | `1` | Days after `periodEnd` before first nudge to employees |
| `submitReminderMaxDays` | int 1..60 | `7` | Stop point — HR should intervene past this |
| `approvalReminderStartDays` | int 0..30 | `2` | Days after `periodEnd` before nudging approvers |
| `approvalReminderMaxDays` | int 1..60 | `14` | Stop nudging approvers |

Cross-field guard: `maxDays >= startDays` enforced both by the DB
`CHECK` constraint and by the service's `validateCrossFields`.

### 3. Pure decision layer

`apps/api/src/timesheet/domain/scheduler-decision.ts` exposes three
functions, each pure and independently tested:

- `decideAutoGenerate(facts)` — should we run `generateForPeriod`?
- `decideSubmitReminder(facts)` — should we nudge THIS employee?
- `decideApprovalReminder(facts)` — should we nudge the approver
  queue for THIS timesheet, and if so which queue?

Timezone-aware calendar-day math is implemented via
`Intl.DateTimeFormat('en-CA', { timeZone })` + Y-M-D string diffs —
no timezone-library dependency, no DST drift risk (we deliberately
never subtract wall clock hours across a boundary).

### 4. Idempotency & concurrency

- **Auto-generation** reuses `TimesheetService.generateForPeriod`,
  which upserts on `(companyId, periodStart, periodEnd)` and on
  `(userId, periodId)`. Firing twice on the same day is a no-op.
- **Reminders** are gated by a new append-only table
  `TimesheetReminderLog` with a unique index on
  `(timesheetId, type, sentDate)`. The worker inserts the log row
  FIRST (inside the same transaction as the notification create); a
  concurrent replica hits `P2002` and silently skips. This is the
  same pattern used by the DSAR worker for job claiming.

The reminder-log table is `REVOKE UPDATE FROM PUBLIC` — it's an
audit trail and must not be mutated after write. Retention worker
prunes rows older than the tenant's `notificationRetentionDays`.

### 5. Blast radius

Every tenant is swept in its own try/catch. A crash mid-tenant does
not roll back earlier tenants and does not stop later ones — the
worker records the failure at ERROR level and moves on. Next day's
run picks up the same tenant if the underlying data is still
in-scope.

The worker is disabled on follower replicas via
`TIMESHEET_SCHEDULER_ENABLED=false` — matches the pattern used by
`WEBHOOK_WORKER_ENABLED` and `RETENTION_WORKER_ENABLED`.

## Consequences

**Positive**

- End-to-end automation of the timesheet cycle: HR now only touches
  the process when a real exception occurs (approvals, corrections).
- Notification volume is bounded: per-employee submit reminders max
  at `submitReminderMaxDays - submitReminderStartDays + 1` per period,
  same for approvers.
- Reminder cadence is a per-tenant knob so aggressive vs. gentle
  cultures can both be accommodated without code changes.
- Backfills for existing tenants are automatic on first sweep — no
  data migration required.

**Negative**

- One more moving part in production. Ops must monitor the daily
  sweep log line and alert on repeated tenant-scoped errors.
- The service pulls "all timesheets in the last 60 days" per sweep.
  For large tenants that's up to `N_employees × periods_per_60d` rows
  — currently bounded well under 10k rows per query. If a customer
  exceeds this we'll add pagination.

**Follow-ups (out of scope for this ADR)**

- Per-tenant dispatch hour (multi-region customers).
- FE widget showing "you were reminded N times this period".
- Escalation ladder: after `submitReminderMaxDays` auto-escalate to
  HR instead of just stopping.
