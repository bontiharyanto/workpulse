# ADR-0029 — Reopen APPROVED timesheet (Fase 32g)

Status: Accepted
Date: 2026-08-03
Supersedes: —
Related: [ADR-0024](./ADR-0024-timesheet-workflow.md), [ADR-0027](./ADR-0027-outbound-webhooks.md)

## Context

Once a timesheet reaches `APPROVED`, the two-tier workflow considers
the row **final** — supervisor + HR have both signed, and it is
eligible for payroll export. In practice HR occasionally needs to
correct an already-paid row: an OT rate was miscalculated, an absence
type was misclassified after HR reviewed a doctor's note that arrived
late, or an operator noticed a scanner-cursor bug that padded a shift.

Fase 32b's original state machine intentionally treats `APPROVED` as a
sink — no legal transitions out. Without an explicit "reopen"
transition, the only remedies for a bad approval are:

1. Ask the DBA to hand-edit the row (breaks the audit trail, no
   downstream notification).
2. Void the whole period + re-generate (nuclear; loses supervisor /
   HR history for everybody else).

Both are unacceptable for enterprise operations. Fase 32g adds a
first-class reopen path.

## Decision

Introduce a single new admin-only mutation, `POST
/api/v1/admin/timesheet/:id/reopen`, guarded by `RolesGuard('HR_MANAGER',
'SUPER_ADMIN')`. The mutation:

1. **Validates** using a pure decision function in
   `apps/api/src/timesheet/domain/reopen-validation.ts`. The row must
   be `APPROVED`; the actor must hold `HR_MANAGER` or `SUPER_ADMIN`;
   the mandatory `reason` must be **10..500 characters after trim**.
   All issues are collected before mapping to HTTP codes so the
   response can list every problem in one shot.
2. **Resets** the row to `DRAFT`, wiping `submittedAt`, `supervisorId`,
   `supervisorAt`, `supervisorNote`, `hrManagerId`, `hrManagerAt`,
   `hrManagerNote`, and the reject columns. The state machine's
   normal `SUBMIT → SUPERVISOR_APPROVE → HR_APPROVE` chain must be
   walked again on re-submit.
3. **Bumps** `Timesheet.reopenCount` (new integer, `DEFAULT 0`) and
   records the hot-path denorm columns `lastReopenedAt`,
   `lastReopenedById`, `lastReopenReason` for badge rendering.
4. **Writes an audit log** with `action='TIMESHEET_REOPENED'`,
   `beforeJson` capturing the pre-reset supervisor/HR provenance, and
   `afterJson` carrying the new status, reason, and count. Audit rows
   remain the immutable long-term history — the denorm columns are
   just a cache.
5. **Notifies** the timesheet owner + their direct supervisor. HR are
   not notified (they initiated the action). If the actor happens to
   also be the supervisor (small orgs / fill-in role), the supervisor
   notification is skipped.
6. **Enqueues** a `TIMESHEET_REOPENED` webhook (`timesheet.reopened`)
   with the reason, `reopenCount`, period metadata, and the reopener's
   id/email. Downstream payroll systems that already ingested the
   paid row should mark it pending re-verification.

The reopen action is throttled by the existing global controller
throttler; no new limiter is introduced.

## Alternatives considered

- **Reset to `PENDING_HR` instead of `DRAFT`.** Would let HR "fast
  approve" the reopened row on the next click, skipping supervisor
  review. Rejected: the whole point of the reopen is that something
  was wrong; the supervisor should look at the corrected data too.
  Full chain re-review is worth the extra clicks for a rare action.
- **Block reopen when a `TimesheetExport` already references the
  period.** Rejected: the payroll cycle is exactly when corrections
  are most likely to be needed. The webhook is the escape hatch —
  vendors invalidate their cached row instead.
- **Silent audit-only reopen (no notification / no webhook).** Rejected:
  a paid row silently changing under the employee's feet is a trust
  violation. Notifications close the loop.
- **Bypass the state machine and update `APPROVED → APPROVED` with a
  patch column.** Rejected: it would mean two audit stories for the
  same lifecycle event and complicates payroll reconciliation.

## Consequences

Positive:

- HR can correct post-payroll rows without touching the DB or nuking
  a period.
- Downstream systems get a signed webhook so a vendor can hold or
  reverse the corresponding pay item.
- `reopenCount > 0` becomes a data-quality signal — a tenant repeatedly
  reopening the same employee's rows should be reviewed for scanner
  reliability, shift assignment errors, etc.

Negative / trade-offs:

- The row loses its supervisor / HR provenance columns after reopen
  (moved to `AuditLog.beforeJson`). Consumers that hydrate directly
  from `Timesheet` must not treat `supervisorId=null` as "was never
  supervised" — check `reopenCount > 0` first.
- Each reopen produces two notification rows + one webhook enqueue;
  chatty tenants who reopen dozens of rows per cycle will see churn.
  The webhook events are idempotent (`sourceId` = `reopen_{id}_{n}`)
  so re-firing the same event is a no-op.

## Rollback

- Drop the `POST /:id/reopen` route on the FE (remove the button).
- Remove the `TIMESHEET_REOPENED` enum from `NotificationType` and
  `WebhookEventType` and revert the migration if no reopens have been
  recorded. Rows with `reopenCount > 0` still hold the audit trail
  under `TIMESHEET_REOPENED` — safe to leave those history rows in
  place.
