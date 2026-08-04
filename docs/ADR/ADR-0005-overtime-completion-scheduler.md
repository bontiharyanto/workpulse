# ADR-0005 — Overtime Completion Scheduler

- **Status:** Accepted
- **Date:** 2026-08-02
- **Deciders:** Backend, HR/Payroll

## Context

The Overtime Module in MVP terminates at the `APPROVED` state. This leaves the
lifecycle open-ended: an approved overtime request sits in `APPROVED` forever,
and downstream systems (payroll, reports) cannot easily distinguish
"supervisor said yes" from "employee actually worked the extra hours".

Two semantic gaps result:

1. **Payroll ambiguity.** The Overtime Summary Report currently filters to
   `APPROVED + COMPLETED` by default. Without any promotion mechanism, only
   `APPROVED` rows ever appear, and HR must trust supervisor decisions
   without attendance cross-checking.
2. **Audit trail loss.** The moment a supervisor approves is captured
   (`approvedAt`), but there is no timestamp indicating when — or whether —
   the hours were verified against actual clock-in / clock-out data.

We need a mechanism to promote `APPROVED → COMPLETED` **automatically** once
attendance for the corresponding `workDate` is confirmed.

## Decision

Introduce a **daily scheduled job** (`OvertimeSchedulerService`) that runs at
02:00 server time (`CronExpression.EVERY_DAY_AT_2AM`). The core promotion
logic (`OvertimeCompletionService`) is:

1. Query all `OvertimeRequest` rows where `status = 'APPROVED'` AND
   `workDate ≥ now - 90 days` (dead-letter cutoff).
2. For each candidate, load the sibling `AttendanceRecord` at
   `(userId, workDate)`.
3. Run pure-function eligibility (`decideOvertimeCompletion`):
   - `status === 'APPROVED'`
   - `now.utcDay > workDate + graceDays`
   - `attendance.clockInAt !== null && attendance.clockOutAt !== null && attendance.deletedAt === null`
4. If eligible, update `status = 'COMPLETED'` and set `completedAt = now`.

Each promotion is a **single-row transaction**. Failures on individual rows
are caught and logged; the batch continues. Idempotent — safe to run any
number of times.

Additional plumbing:

- **`Company.overtimeCompleteGraceDays`** (default `2`) — per-tenant grace
  period after `workDate` before the scheduler will consider a row. Gives
  supervisors time to enter late timesheet corrections without racing the
  cron.
- **`OvertimeRequest.completedAt DateTime?`** — set at promotion. Doubles as
  the audit trail for system-triggered completions (see "Audit trail" below).
- **Manual trigger:** `POST /api/v1/admin/overtime/run-completion`
  (HR_MANAGER / SUPER_ADMIN, scoped to caller's tenant, rate-limited 4/min).
  Runs the same code path — useful after attendance backfill.

## Alternatives Considered

### 1. Manual "Mark Completed" button in the approval UI

Simple but wrong semantics: forces HR to click daily for every approved OT.
Rejected — this is exactly the toil the scheduler eliminates.

### 2. Complete on attendance clock-out (event-driven)

Wire the completion logic to fire when `AttendanceRecord.clockOutAt` is set.
Rejected for two reasons:

- Grace period cannot be enforced cleanly — the completion would fire
  immediately on clock-out, before any late timesheet edits.
- Requires coupling `AttendanceModule` → `OvertimeModule`; the reverse
  dependency (overtime querying attendance on demand) is much cleaner.

### 3. External Kubernetes CronJob calling the admin endpoint

Rejected as the primary mechanism (would tie deploy topology to a business
rule) but _kept as an option_ — because the manual endpoint exists, ops can
disable the in-process `@Cron` and call the endpoint from any external
scheduler if audit / ops policy demands it.

### 4. Aggressive auto-reject of OT without attendance

E.g. `APPROVED → REJECTED('NO_ATTENDANCE')` after N days.

Rejected for MVP: reversing an approval without human review is dangerous
(what if attendance was lost due to a device outage?). The current design
leaves such rows in `APPROVED` indefinitely; HR can see them via the
Overtime Summary Report and act manually. Future iteration may add a
dashboard "stale approved" widget.

## Consequences

### Positive

- Closes the OT lifecycle — every `APPROVED` request now has a defined
  terminal path.
- Overtime Summary Report becomes payroll-grade: `COMPLETED` rows are
  provably reconciled against attendance.
- Pattern is generalizable — future modules (leave, timesheet corrections,
  retention cleanup) can adopt the same `@Cron` + pure-domain + admin
  manual-trigger shape.

### Negative

- Adds a `@nestjs/schedule` dependency (~40 KB).
- Cron runs in-process, so scaling to multiple API replicas requires a
  leader-election strategy (or moving the trigger to external Kubernetes
  CronJob). Documented for future work; single-replica dev/staging is fine.
- Attendance queries are per-row inside the loop — cheap for MVP volumes
  (hundreds/day) but a natural target for batching if the tenant scales to
  thousands/day.

### Audit trail

`AuditLog.actorId` is a required foreign key to `User`. The system has no
`User` row, so system-triggered completions **do not** write to `AuditLog`.
Rationale for accepting this:

- The `completedAt` column serves as an immutable timestamp of when the
  transition occurred.
- Structured logs (NestJS `Logger`) capture per-run counts, per-row skips,
  and any failed promotions — shipped to Datadog for observability.
- If regulatory audit later requires DB-persisted rows for system events, a
  synthetic "system user" per tenant can be created without breaking this
  design.

## Flow

```
                 ┌────────────────────────┐
                 │  cron @Cron(EVERY_DAY_AT_2AM)  │
                 └───────────┬────────────┘
                             │ runDaily()
                             ▼
                 ┌────────────────────────────┐
                 │  OvertimeCompletionService │
                 │      .runCompletion()      │
                 └───────────┬────────────────┘
                             │
     ┌──── query APPROVED (last 90 days) ─────┐
     │                                        │
     ▼                                        ▼
 for each candidate                    load AttendanceRecord
     │                                        │
     └───────────────┬────────────────────────┘
                     ▼
        decideOvertimeCompletion() (pure)
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
    ELIGIBLE                    SKIP(reason)
        │                         │
   promote(row)              logger.log
        │
   ┌────┴───────────────────┐
   │ status = COMPLETED     │
   │ completedAt = now      │
   └────────────────────────┘
```

## Related

- ADR-0002 — Multi-Tenant Data Isolation (per-tenant scoping of the admin
  endpoint).
- WORKFLOW.md §4.6 — user-facing description of the mechanism.
