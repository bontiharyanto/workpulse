# ADR-0023 — Timesheet Foundation (Fase 32a)

- **Status**: Accepted
- **Date**: 2026-08-02
- **Deciders**: Principal FS Engineer, HR domain stakeholder

## Context

Workpulse already captures every atomic HR event we need for payroll:
`AttendanceRecord` (clock-in/out), `OvertimeRequest` (COMPLETED), `LeaveRequest`
(APPROVED), `AbsenceRecord`, `Holiday`, and `UserShiftAssignment`. What was
missing was a **per-period consolidation** that HR could review before
handing numbers off to payroll — the industry-standard "timesheet".

The user explicitly asked to introduce this module _before_ moving on to the
next compliance sub-phase (Fase 31d). We had to decide four things up front:

1. **How to slice time.** Weekly? Bi-weekly? Monthly? Cutoff-based?
2. **How to store the data.** Live view over the sources, or materialised
   snapshot table?
3. **Approval workflow.** Self-acknowledgement, single-tier, or multi-tier?
4. **Rollout order.** Everything at once, or a phased delivery?

## Decision

We split the module into three sub-phases and delivered **32a — foundation &
read-only** first.

- **Period types** — supported all four (`WEEKLY`, `BIWEEKLY`, `MONTHLY`,
  `CUTOFF`), configurable per tenant via `TimesheetConfig`. `CUTOFF` uses a
  `cutoffDayOfMonth` in `[1, 28]`; anything higher would misfire on Feb.
- **Storage** — **materialised** snapshot in `Timesheet` + `TimesheetEntry`.
  Rationale: payroll cutoff (`payrollLockedUntil`) already means a
  timesheet's answer must not change after locking. A materialised row is
  the cleanest way to freeze the answer while still allowing HR to
  regenerate on demand (before lock) when corrections land.
- **Workflow** — multi-tier (Supervisor → HR Manager) will land in Fase 32b.
  32a is deliberately **read-only** so HR can inspect the generator's output
  in production before we build the submit/approve UX on top.
- **RBAC**
  - Employees see only their own timesheets under `/me/timesheet/*`.
  - Supervisors see their direct reports under `/admin/timesheet`.
  - HR Manager and Super Admin see everyone.
- **Concurrency** — the generator is idempotent. Rerunning
  `TimesheetService.generateForPeriod(companyId, at)` upserts the
  `TimesheetPeriod` (unique on `companyId + start + end`), then per-user
  wipes+rewrites `TimesheetEntry` inside a single transaction. Two
  simultaneous HR clicks land on the same rows — the second one wins, no
  duplication.
- **Timezone** — every date math happens in the tenant `timezone` (default
  `Asia/Jakarta`). The period calculator uses `Intl.DateTimeFormat` for
  weekday + month resolution instead of adding a moment/luxon dependency
  (see `apps/api/src/timesheet/domain/period-calculator.ts`).

## Consequences

Positive:

- Payroll gets a **stable, per-period unit of aggregation** it can hang
  export flows off (Fase 32c).
- The compose-order (Holiday → Leave → Attendance → Absence → Weekend) is
  encoded in a _pure_ domain helper (`buildEntry`) — trivially testable and
  reusable when 32b adds correction re-generation.
- HR can already inspect data quality before we bolt on the submit/approve
  flow; discovering a broken shift assignment during 32a is much cheaper
  than during a live approval queue.

Negative / trade-offs:

- Materialised entries mean **the generator must be re-run** whenever a
  source row changes retroactively (a supervisor-approved
  `AttendanceCorrection`, a late-arriving `OvertimeRequest` on the previous
  Friday). 32b will wire the correction service to trigger a re-generate;
  32a covers this manually via HR "Regenerate".
- Multi-tenant fanout is quadratic in the naive path (N companies × N users
  each). Fine at Workpulse's current scale; if we onboard a tenant with
  ~10k users we'll batch entry inserts by chunking `createMany`.
- The current shift assignment resolver assumes **Monday–Friday** working
  weekdays with a fixed hours/day derived from `Shift.startTime` and
  `Shift.endTime`. Rotating / flexible shifts land in Fase 32b.

## Rejected alternatives

1. **Live view over source tables.** Pro: no state to reconcile. Con: makes
   payroll immutability impossible — a retroactive attendance edit would
   silently mutate last-quarter's payroll input, which is exactly the class
   of bug the `payrollLockedUntil` mechanism exists to prevent.
2. **Weekly-only.** Would ship in a day but forces every Indonesian tenant
   (which almost universally run monthly payroll) into a foreign period
   shape.
3. **Materialise ONLY when submitted.** Attractive at first — no snapshot
   for draft periods, only a snapshot when the user submits. Rejected
   because HR still needs to inspect the current-period rollup **before**
   the user submits (the "how many hours did I work this month?" question
   is 100× more common than "was my submitted timesheet approved?").

## Follow-up phases

- **32b** — Submission workflow (Supervisor → HR Manager approval),
  `AttendanceCorrection`-driven auto-regenerate, entry-level lock semantics.
- **32c** — Payroll export (CSV/XLSX) tied to `payrollLockedUntil`, with an
  audit trail on every export.

## References

- `apps/api/prisma/schema.prisma` — `TimesheetConfig`, `TimesheetPeriod`,
  `Timesheet`, `TimesheetEntry`, `TimesheetPeriodType`, `WeekStartDay`,
  `TimesheetEntryKind`.
- `apps/api/src/timesheet/**` — services, controllers, domain helpers.
- `apps/api/prisma/migrations/20260802220000_add_timesheet_foundation/` —
  DDL.
- `docs/WORKFLOW.md` §11 — end-to-end business flow.
