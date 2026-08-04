# ADR-0024 — Timesheet submission workflow & auto-regenerate policy (Fase 32b)

- **Status:** Accepted
- **Date:** 2026-08-03
- **Owners:** Workpulse HR platform team
- **Follows:** [ADR-0023 — Timesheet foundation](./ADR-0023-timesheet-foundation.md)

## Context

Fase 32a shipped a **read-only, materialised** timesheet: HR generates a
period, the FE renders totals, employees see their own numbers. Nothing
in that surface answers three real HR needs, however:

1. **Who signed off on the payroll numbers for this period?** — the
   audit story stops at "the generator ran".
2. **What happens when an AttendanceCorrection is approved *after*
   HR already reviewed the timesheet?** — the totals silently drift.
3. **Break time is unpaid, but Fase 32a's `regularHours` includes it.**

Fase 32b closes those three gaps.

## Decision

### 1. Two-tier approval workflow

We mirror the existing leave workflow: `DRAFT → PENDING_SUPERVISOR →
PENDING_HR → APPROVED`, with `REJECTED` as an escape hatch that loops
back to the employee. The state machine lives in a **pure** module
(`apps/api/src/timesheet/domain/submission-workflow.ts`) so it's easy
to unit-test and easy to reason about.

**Why two tiers, not just HR?**

- Supervisors know their team's schedule anomalies (someone worked a
  weekend on a client emergency; someone was on training). HR does not,
  and asking HR to spot every anomaly across the tenant would create a
  bottleneck.
- Supervisors act as a sanity gate; HR carries the final payroll seal.
- Enterprise HR teams already expect this shape from leave and OT.

**Actor rules:**

| Action                | Required actor                                     |
|-----------------------|----------------------------------------------------|
| `SUBMIT`              | Timesheet owner. `DRAFT` or `REJECTED`.            |
| `SUPERVISOR_APPROVE`  | Direct supervisor of the owner, OR HR / SUPER_ADMIN. |
| `SUPERVISOR_REJECT`   | Same as above. **Note is required.**               |
| `HR_APPROVE`          | `HR_MANAGER` or `SUPER_ADMIN`.                     |
| `HR_REJECT`           | Same. **Note is required.**                        |

Rejection notes are required at the state-machine level because an
employee cannot fix a rejection they don't understand — a missing note
turns HR review into a black-box loop.

### 2. Auto-regenerate on AttendanceCorrection

When an `AttendanceCorrection` is approved (Fase 26), the affected
day's clock-in/out changes and the timesheet totals *must* follow.
Options considered:

| Option                                              | Verdict           |
|-----------------------------------------------------|-------------------|
| Refuse the correction if a timesheet exists         | Too aggressive — DRAFTs are meant to be edited. |
| Auto-regenerate always                              | Chosen for DRAFT / REJECTED / PENDING_*.        |
| Auto-regenerate only if DRAFT                       | Rejected — silently drops a pending review.     |
| Refuse the correction if the timesheet is APPROVED  | Chosen — payroll seal is non-negotiable.        |

**Implementation:**

1. Inside the correction's `$transaction`, we call
   `TimesheetService.assertCorrectionAllowed(tx, ...)`, which throws
   `409 TIMESHEET_APPROVED_LOCK` if the timesheet is `APPROVED`. This
   race-proofs the check against a concurrent HR approval.
2. After the correction commits, we call
   `TimesheetService.regenerateForCorrection(companyId, userId, workDate)`.
   The regenerate is idempotent: it rebuilds the entries + rollups
   for the affected period from source rows.
3. If the timesheet was in `PENDING_SUPERVISOR` or `PENDING_HR`, we
   reset it to `DRAFT` and wipe the decision columns. Rationale: the
   review the supervisor/HR performed no longer reflects the numbers,
   so their signature must be renewed by explicit re-submission. A
   `TIMESHEET_REGENERATED` notification tells the owner to review.
4. Regenerate runs OUTSIDE the correction transaction. If it fails,
   we log-and-continue rather than rolling back the correction —
   which is a legitimate business action on its own. HR can trigger
   a manual "Generate periode berjalan" to fix any orphaned state.

The `TIMESHEET_APPROVED_LOCK` on APPROVED periods works alongside
Fase 27's `Company.payrollLockedUntil`: `payrollLockedUntil` locks by
date range across ALL users; `TIMESHEET_APPROVED_LOCK` locks per user
via the seal from HR.

### 3. Break-time deduction

`Shift.breakMinutes` (default 0, configurable per shift) is now
subtracted from `regularHours` at generate time. Rules:

- `hoursWorked = clamp(clockOutAt − clockInAt − breakMinutes/60, 0, ∞)`.
- `expectedHours = clamp(shiftEnd − shiftStart − breakMinutes/60, 0, ∞)`.
- Never allowed to go negative — a mis-configured 12-hour break on a
  4-hour shift produces `0`, not a payroll credit.

### 4. HR bulk-regenerate skips `APPROVED`

`TimesheetService.generateForPeriod` now returns
`{ periodId, timesheetsGenerated, timesheetsSkippedApproved }`. Users
whose timesheet in that period is `APPROVED` are silently skipped so
HR doesn't accidentally break their own payroll seal by hitting the
"Generate" button twice. The FE could later expose an "un-approve"
action for edge cases; that's out of scope for 32b.

## Data model changes

- `Shift.breakMinutes Int @default(0)`
- `Timesheet.status TimesheetStatus @default(DRAFT)`
- `Timesheet.submittedAt DateTime?`
- `Timesheet.supervisorId / supervisorAt / supervisorNote`
- `Timesheet.hrManagerId / hrManagerAt / hrManagerNote`
- `Timesheet.rejectedById / rejectedAt / rejectionReason`
- `Timesheet_companyId_status_idx` for the queue view.
- `NotificationType`: adds `TIMESHEET_SUBMITTED`,
  `TIMESHEET_APPROVED_SUPERVISOR`, `TIMESHEET_APPROVED_HR`,
  `TIMESHEET_REJECTED`, `TIMESHEET_REGENERATED`.

## API surface

New endpoints:

- `POST /me/timesheet/:id/submit` → 204. Owner-only. Legal from
  `DRAFT` or `REJECTED`. Refuses (409) if `periodEnd > today`.
- `POST /admin/timesheet/:id/decide` → 204. Body:
  `{ action: 'SUPERVISOR_APPROVE' | 'SUPERVISOR_REJECT' | 'HR_APPROVE' | 'HR_REJECT', note?: string }`.
  Rejection actions require a non-empty `note` (409 otherwise).

Extended endpoints:

- `GET /admin/timesheet` accepts `status=DRAFT|PENDING_SUPERVISOR|
  PENDING_HR|APPROVED|REJECTED`. The queue view filters by this.
- `POST /admin/timesheet/generate` returns
  `timesheetsSkippedApproved` alongside `timesheetsGenerated`.

## Consequences

**Good.**

- Full audit trail per timesheet — every state change writes an
  `AuditLog` row inside the same transaction.
- Notification fan-out mirrors leave; users learn the workflow once.
- Correction-driven regeneration keeps payroll data honest without
  breaking the audit story for reviews already signed off.

**Trade-offs.**

- Auto-regenerate outside the correction tx can leave stale state on
  a transient DB error. Mitigation: idempotent generator + explicit
  HR "Generate" button + operator alerts on error logs.
- Rejection resets the whole review chain: a rejection at the
  `PENDING_HR` tier still forces the employee to re-submit through
  the supervisor. This matches how leave works; a "HR-only ping-pong"
  variant would add complexity without a clear payoff.

## Testing

- Unit: `submission-workflow.spec.ts` covers the full transition
  matrix + RBAC gates (15 assertions).
- Unit: `timesheet-submission.service.spec.ts` covers happy paths +
  reject-note-required + non-owner refusals (10 assertions).
- E2E: `timesheet-workflow.spec.ts` walks a real
  DRAFT → PENDING_SUPERVISOR → PENDING_HR → APPROVED with the
  Playwright API context, and verifies (a) reject-and-resubmit,
  (b) period-not-ended refusal, (c) `timesheetsSkippedApproved` on
  bulk regenerate, (d) non-team supervisor is refused.

## Non-goals for 32b

- **On-behalf-of submit by HR.** If an employee is unavailable and HR
  needs to close a period, HR uses `Generate` + manual approval
  (workflow-tier bypass via `HR_APPROVE` on any state has been
  intentionally *not* wired — it stays a two-step process for the
  audit story). Deferred to 32c.
- **Per-day approval / entry-level locks.** Whole-period only.
- **Configurable break windows per day / per user.** The shift-level
  default is enough for most tenants; per-day exceptions can piggyback
  on `AttendanceCorrection`.
- **Payroll integration.** APPROVED signals the intent, but the
  downstream payroll export is a separate module (32c or later).
