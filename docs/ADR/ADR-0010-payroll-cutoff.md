# ADR-0010 — Payroll Cutoff Enforcement

- **Status:** Accepted
- **Date:** 2026-08-02
- **Deciders:** Backend, HR/Payroll, Finance
- **Extends:** ADR-0008 (auto-absent scheduler), ADR-0009 (manual HR
  absence override) — both explicitly called out payroll cutoff as a
  follow-up.
- **Related:** ADR-0005 (overtime completion scheduler — same
  "closed period" concern for overtime, tracked separately).

## Context

Once a payroll period closes and paychecks go out, the attendance
rows underlying those paychecks become **contractual evidence**. Any
retroactive change to those rows creates a real, expensive
discrepancy:

- Employees see "you were absent 3 more days than I got paid for" or
  vice versa.
- Auditors demand a reconstruction trail.
- Finance has to write compensating journal entries.

Prior to this ADR the API had **no defense** against retroactive
attendance mutation. Post-payroll HR could:

- Manually mark absent (`POST /attendance/absence`) inside a closed
  period.
- Delete a scheduler-created absence that had already reduced
  someone's paycheck.
- Trigger the auto-scanner (`POST /attendance/scanner/run`) and have
  it retroactively classify frozen days.

We need a hard, auditable **write barrier** across all three surfaces.

## Decision

### D1. Single column on `Company`: `payrollLockedUntil DATE NULL`

Inclusive cutoff. `NULL` means no cutoff (safe default; existing
tenants unchanged). Semantics chosen so "close July" is `2026-07-31`,
not "2026-08-01 exclusive" — off-by-one-free.

`@db.Date` (not `TIMESTAMP`) because payroll periods close on
**calendar** boundaries, not on wall-clock instants. Storing a
timestamp would make cross-timezone comparisons ambiguous
("2026-07-31 UTC" is still 2026-08-01 in Jakarta).

We considered a richer `payrollPeriod` table (period id, opened-at,
closed-at, closed-by). Rejected for now — YAGNI. Once ops actually
needs a period audit UI we'll graduate to that model; today, a single
scalar plus the audit log covers the current use case.

### D2. Enforcement at the service layer, not the DB layer

The guard lives in `apps/api/src/attendance/domain/payroll-lock.ts`
and is called by `AttendanceService.markAbsent`,
`AttendanceService.deleteAbsence`, and `AbsenceScannerService.scanCompany`.

Alternatives we considered:

- **Postgres CHECK constraint** on `AbsenceRecord`. Rejected because
  the error surface is a generic 500 (Prisma exposes it as
  `PrismaClientKnownRequestError` with code `P0004`), which the FE
  cannot programmatically handle. Losing the ability to say `code:
  'PAYROLL_LOCKED'` was too painful.
- **Postgres trigger**. Same issue as CHECK plus harder to test.
- **Middleware over Prisma**. Would work but the guard needs to know
  the actor's role (for the SUPER_ADMIN bypass), and Prisma
  middlewares run below that context.

The domain module exports a pure `isPayrollLocked` predicate + an
imperative `assertPayrollNotLocked` guard. Same primitives are used
by the scheduler (which SKIPS) and the imperative writes (which
THROW). One source of truth for the "is this frozen?" question.

### D3. SUPER_ADMIN emergency override

HR mutations at `workDate <= cutoff` return 409 CONFLICT. SUPER_ADMIN
mutations succeed unconditionally.

We considered blocking every role. Rejected because:

1. **Real corrections happen.** Auditor discovers a paycheck was
   wrong; the DB has to catch up.
2. **Data migration.** Onboarding a new tenant means importing years
   of historical attendance, some of which will be inside their
   already-closed periods. Without an override lane, ops has to
   bypass via psql — which loses the audit trail we care most about.
3. **Concentrating override authority.** Giving *one* role the
   power (versus HR_MANAGER) means override attempts are rare,
   deliberate, and traceable. Every override still writes
   `ATTENDANCE_MARK_ABSENT` / `ATTENDANCE_UNMARK_ABSENT` audit rows
   with the actor id.

We rejected requiring a second field (e.g. "override reason") on the
DTO for SUPER_ADMIN overrides. The audit log's `afterJson.reason`
already carries the note, and any reason field on the request would
be duplicative. If a future audit UI wants richer prompts, that's
a client concern.

### D4. Scheduler SKIPs, cursor still advances

`AbsenceScannerService.scanCompany` short-circuits locked dates
BEFORE loading the roster. This is cheap (one integer compare) and
avoids materialising the roster for a period the scanner is going
to leave untouched anyway.

The subtlety: **the cursor still advances past skipped dates**.
Rationale — if we held the cursor back at the locked dates, every
hour the scanner would waste a `company.findMany` on the same
locked range. By advancing past, steady-state cost stays near zero.

**Trade-off:** if HR later moves `payrollLockedUntil` **backwards**
(unusual — requires SUPER_ADMIN in practice), the scanner will NOT
retroactively re-classify the newly-unlocked days. The cursor is
already past. If retroactive classification is needed, ops must
reset the cursor by hand and hit `POST /attendance/scanner/run`.
Documented in WORKFLOW §1.8.

### D5. `PAYROLL_LOCKED` counted per-date, not per-user

Every other skip reason in the scheduler counts users
(`ALREADY_MARKED: 3` = 3 users). `PAYROLL_LOCKED` counts DATES
because the short-circuit happens before roster load — we don't know
the user count. This is inconsistent, but pretending we scanned the
roster would be worse. Documented in `AbsenceSkipReason`.

### D6. UI: banner + disabled buttons, no client-side enforcement

The FE fetches `/admin/company` (HR+ role only), compares selected
date vs cutoff, and (a) shows a banner explaining the lock, (b)
disables mark/delete buttons on locked rows with a tooltip.

**Server is still the source of truth.** Disabling buttons is UX
polish; every user request re-validates on the server. This is
important because:

- A stale FE cache could show the button as enabled after HR just
  locked the period elsewhere.
- SUPER_ADMIN uses the same UI as HR_MANAGER; we don't have a
  separate "admin mode" component. Rather than dynamically enabling
  overrides (fragile), we ask SUPER_ADMIN to hit the API directly
  when they need to override.

### D7. Cutoff mutation goes through the same audit log

`Company.payrollLockedUntil` changes record `COMPANY_CONFIG_UPDATED`
with `beforeJson: { payrollLockedUntil: '2026-06-30' }` /
`afterJson: { payrollLockedUntil: '2026-07-31' }`. Same shape as
every other config change; no new audit surface.

## Consequences

### Positive

- Payroll and DB stay consistent by construction, not by discipline.
- Auditors have a single query surface (`AuditLog` filtered by
  `entityType IN ('AbsenceRecord', 'Company')`) to reconstruct every
  post-close mutation.
- Finance can confidently close a period without fearing async
  scheduler ticks will drift the data underneath them.

### Negative / trade-offs

- **Cursor-past-lock behavior surprises admins who move the cutoff
  backward.** Documented in WORKFLOW §1.8 with the ops-level fix.
  Rare enough that we accept this.
- **No per-cutoff audit reason.** If we later want "why was this
  period reopened?", we'd need a `PayrollPeriod` table. Deferred.
- **UI doesn't distinguish SUPER_ADMIN vs HR.** SUPER_ADMIN who
  wants to override sees the same disabled buttons; they have to
  fall back to the raw API. Deliberate — override should be a
  conscious act, not a one-click affair.

## Alternatives Considered

1. **Per-user cutoff (`User.payrollLockedUntil`).** Rejected — payroll
   closes tenant-wide, not per-user.
2. **A stack of periods (`PayrollPeriod[]`).** Rejected — YAGNI; single
   scalar covers the current use case.
3. **Time-based cutoff (`payrollLockedUntilAt: DateTime`).** Rejected —
   see D1 (calendar semantics matter, timezone-sensitivity is a bug).
4. **No override at all.** Rejected — see D3.
5. **Frontend-only enforcement.** Rejected — server-side is
   non-negotiable for financial invariants.

## Follow-ups

### ✅ Extended in Phase 18 (2026-08-02)

The two "extend to leave / overtime" follow-ups are now closed. Design
notes worth preserving for future readers:

- **Shared helper.** `payroll-lock.ts` moved from `attendance/domain/`
  to `common/domain/` so leave + overtime import it directly. SUPER_ADMIN
  bypass is encoded once in the helper; each caller only has to translate
  `PayrollLockedError` → `ConflictException` at the framework boundary.
- **Range semantics for leave.** `LeaveRequest.startDate` is the anchor.
  Deliberately NOT "any overlapping day" — a request that overlaps the
  cutoff boundary (e.g. cuti 25-Jul → 05-Aug with cutoff 31-Jul) is
  treated the same as one fully inside the frozen range, because a
  partially-frozen leave would already produce a payroll discrepancy
  and forcing a range split at the boundary is worse UX than refusing
  outright and letting HR resubmit two requests.
- **Overtime completion scheduler.** Skipped rows count per-row (not
  per-date, unlike the absence scanner) — the completion scheduler is
  intrinsically per-candidate. `PAYROLL_LOCKED` is the only skip reason
  that fires *before* the attendance lookup, so a locked backlog does
  not amplify scheduler cost.
- **Submit endpoint role gap.** SUPER_ADMIN is not listed in `@Roles`
  for `POST /leave` or `POST /overtime` (those are employee/supervisor/HR
  scoped). Therefore SUPER_ADMIN cannot exercise submit-bypass in
  practice — the emergency-override lane in leave/overtime is on the
  **decide** endpoint. Documented rather than "fixed" because widening
  the role list would let SUPER_ADMIN self-submit and self-approve,
  which is a bigger governance concern than the missing bypass on a
  path they'd never take anyway.
- **No auto-retry on cutoff release.** If HR closes payroll while an
  APPROVED overtime row is still awaiting completion (grace not yet
  met), the completion scheduler skips it permanently on subsequent
  runs. Recovery is a SUPER_ADMIN decide (REJECT then re-submit), same
  as the auto-scanner cursor advancement — accepting slight ops
  friction in exchange for scheduler simplicity.

### ✅ Cursor-reset workflow closed in Phase 21 (2026-08-02)

- `POST /api/v1/attendance/scanner/reset-cursor` (SUPER_ADMIN only,
  documented in WORKFLOW §1.6). Takes an optional `triggerRescan`
  toggle; the FE tile on the Company Config admin page enforces a
  two-step confirmation (checkbox + arm) before the button becomes
  clickable. Writes a `SCANNER_CURSOR_RESET` audit entry inside the
  same transaction that clears the cursor. Payroll-locked dates are
  still skipped during the ensuing rescan (this endpoint does NOT
  bypass §D4 of this ADR — cursor freshness ≠ frozen-date bypass).
- Scope is intentionally single-tenant (uses `actor.companyId`). Cross
  tenant reset by SUPER_ADMIN is out of scope; SQL + manual audit entry
  is the escalation path for that rare case.
- Notification re-fanout is accepted, not deduped. A tenant that
  triggers `triggerRescan=true` after a cursor drift will re-notify
  affected users about newly-marked absences. This is the intended
  behaviour — "we reclassified your day as absent, here it is again."

### Still open

- If auditor pressure demands it, promote the scalar into a
  `PayrollPeriod` table with reason + reopened-by trail.
- Consider surfacing per-tenant "APPROVED-but-frozen" overtime rows in
  the HR dashboard so they don't silently rot (currently only visible
  via the scheduler log).
