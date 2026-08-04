# ADR-0009 — Manual HR Absence Override

- **Status:** Accepted
- **Date:** 2026-08-02
- **Deciders:** Backend, HR/Payroll, UX
- **Extends:** ADR-0008 (Auto-Absent Scheduler & HR Dashboard) — this
  ADR adds the manual write path that ADR-0008 explicitly deferred.
- **Related:** ADR-0007 (attendance lateness), ADR-0006 (notification
  strategy — same fanout template is reused).

## Context

ADR-0008 shipped the auto-absent scheduler + a canonical `AbsenceRecord`
table with `source ∈ {AUTO_SCHEDULER, MANUAL_HR}`. It deliberately left
`MANUAL_HR` as an unused enum, because we wanted to see the automated
path in production for a full sprint before wiring HR-level writes.

Real-world drivers now forcing the manual endpoint:

1. **Correcting scheduler mistakes.** Approved leave arrives late in
   the pipeline (paper form, external HRIS sync) — the scheduler
   already marked the user absent. Someone needs to be able to **undo**
   an `AbsenceRecord` regardless of whether it was auto or manual.
2. **Retro-classification.** Onboarding a new tenant means importing
   pre-existing attendance history. HR needs to file legacy absences
   without pretending the scheduler was ever running.
3. **Deliberate policy call.** Karyawan tidak masuk tanpa keterangan
   dan window scheduler belum berjalan (mis. sore hari, sebelum jam
   06:00 tenant-lokal keesokan hari). HR ingin mencatat sekarang, tidak
   menunggu cron.

We also need to answer: "How does an HR write differ from a scheduler
write in downstream systems (payroll, notifications, audit)?"

## Decision

### D1. Two thin endpoints, all invariants at service layer

```
POST   /attendance/absence          → 201 Created
DELETE /attendance/absence/:id      → 204 No Content
```

Both are `HR_MANAGER` + `SUPER_ADMIN` only. Both are versioned under
`/api/v1/attendance/...` alongside the scheduler trigger — one module,
one RBAC surface.

The controller layer is intentionally thin: shape validation via a
`class-validator` DTO, RBAC via the `@Roles()` decorator, and forward
to `AttendanceService.markAbsent` / `deleteAbsence`. All the interesting
invariants (tenant isolation, no future dates, no clobbering existing
attendance, notification fanout, audit log) live in the service so
they are unit-testable without a live HTTP stack.

### D2. No new provenance modes — reuse `MANUAL_HR`

We keep the two-value `AbsenceSource` enum. A future "HR bulk import"
flow can be represented either as many `MANUAL_HR` rows (each with a
distinct `markedById`) or as a new enum variant IF and only if
downstream systems must differentiate. YAGNI for now.

### D3. Idempotency = _duplicate → 409_, not _upsert_

`POST` on a pre-existing `(userId, workDate)` returns **409 CONFLICT**,
NOT a silent upsert. Rationale:

- HR often wants to update `reason` after the fact ("was 'no notice',
  actually turns out sick"). Silent upsert would hide the state change
  and skip the audit log.
- The explicit "delete then create" workflow makes every state
  transition observable in `AuditLog`.

The FE mitigates the UX cost by disabling the "Absenkan" button on
rows that already have an `absenceRecordId` (the roster tells us).

### D4. Notification fanout is identical to the scheduler

`markAbsent` emits `ATTENDANCE_ABSENT_MARKED` to (a) the employee, and
(b) their direct supervisor if any. Same template, same deep links.
From the user's perspective, "cron marked me" vs "HR marked me" is
irrelevant — they need to know they were classified absent.

We considered adding an "HR annotation" ("Reason: forgot to file
leave") to the employee notification body. Rejected: `reason` is an
internal audit note, not payroll-visible copy; leaking it risks
tone problems ("HR called you a no-show"). If HR wants to communicate
directly, that's chat/email, not this fanout.

### D5. Team-daily view carries absence metadata

`TeamMemberDailyRow` gained two fields:

- `absenceRecordId: string | null` — id of the backing row when
  `status === 'ABSENT'`, null otherwise.
- `absenceSource: 'AUTO_SCHEDULER' | 'MANUAL_HR' | null` — provenance
  badge for HR to distinguish at a glance.

This threading was necessary because the delete endpoint takes an id,
not `(userId, workDate)`, and we didn't want to burn an extra roundtrip
just to look up the id. The tradeoff: the daily view payload is a bit
wider than strictly needed by supervisors. That's fine — the fields
are inexpensive strings, the schema is already versioned, and the
supervisor UI simply ignores them.

We rejected the alternative "polymorphic id-or-tuple key on delete"
(`DELETE /attendance/absence?userId=X&date=Y`): id-based routes are
easier to instrument (per-row auth logs), cache, and reason about, and
they play nicer with REST tooling (audit systems, retries).

### D6. Reason is trimmed + capped at 500 chars

`reason` is an audit note, not a form field with rich formatting.
500 chars is enough for "leave request lost in email; confirmed
absent verbally 2026-08-01" without inviting essay-length paragraphs.
Empty string / whitespace-only strings normalize to `null` to avoid a
mix of "" vs `null` in analytics.

### D7. Hard delete + audit log, not soft delete

`AbsenceRecord` uses hard `DELETE` on unmark. Rationale:

- The relation is factual: "this classification stands / does not
  stand". Soft delete would leave zombie rows that report queries have
  to `WHERE deletedAt IS NULL`-filter forever.
- `AuditLog(action='ATTENDANCE_UNMARK_ABSENT', beforeJson=…)` gives us
  a complete history in a dedicated system — better than a
  `deleted_at` gravestone which doesn't say _who_ undid it or _when_.
- Payroll cutoff protection is a separate concern (freeze period on
  `Company`) — it will block DELETE by validating `workDate <
payrollCutoff` in the future, not by relying on soft delete.

## Consequences

### Positive

- HR now has full CRUD on absence classification without a database
  console. Ops burden drops.
- The scheduler and manual paths converge in `AbsenceRecord` — one
  aggregation for reports, one place to add downstream hooks (payroll
  push, dispute workflow).
- Notifications provide a fast dispute loop: employee gets pinged
  within seconds of HR marking, not at end-of-month.

### Negative / trade-offs

- **HR can now mark past dates.** We limit "past" to `>= user.hiredAt`,
  but there is no explicit payroll cutoff yet. Future work: a
  `Company.payrollLockedUntil` date that hardens `POST/DELETE` against
  edits inside a closed period.
- **No bulk endpoint.** HR editing a full month at once must call the
  endpoint N times. Deliberate — bulk is a different failure model
  (partial success, resumable jobs) and belongs behind a proper import
  pipeline once demand is proven.
- **`reason` is not surfaced to the employee.** As discussed in D4,
  this is a tone tradeoff; if we later regret it we can add an
  optional `employeeVisibleReason` field.

## Alternatives Considered

1. **Reuse the scanner endpoint with an override flag.** Rejected —
   overloads a maintenance action with business-logic side effects,
   and mixes RBAC ("scanner run" is SUPER_ADMIN, "mark absent" needs
   HR access).
2. **Delete via `(userId, workDate)` tuple.** Rejected — see D5.
3. **Upsert on POST (idempotent-write).** Rejected — see D3.
4. **A separate `AbsenceOverride` table pointing at the
   scheduler-created `AbsenceRecord`.** Rejected — added complexity
   without benefit; the `source` column + audit log already provide
   provenance.

## Follow-ups

- Payroll cutoff enforcement (`Company.payrollLockedUntil`).
- Bulk import CLI (or admin UI) for legacy data — writes many
  `AbsenceRecord` rows in a single transaction with per-row audit
  entries.
- Optional "HR reason visible to employee" field once we have real UX
  research.
- `AbsenceRecord.source` may grow a `HR_BULK_IMPORT` variant when the
  bulk endpoint ships.
