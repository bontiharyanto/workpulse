# ADR-0011 — Attendance Correction (Employee-Initiated)

- **Status:** Accepted
- **Date:** 2026-08-02
- **Deciders:** Backend, HR/Payroll, Frontend
- **Related:** ADR-0009 (manual HR absence override — HR-initiated
  correction), ADR-0008 (auto-absent scheduler — writes the
  AbsenceRecord this feature can invalidate), ADR-0010 (payroll cutoff —
  applies to correction submit/decide/cancel).

## Context

The commonest real-world attendance ticket is "I forgot to clock
in/out". Prior to this ADR the only recovery paths were:

1. **HR manual override** (ADR-0009): HR marks the employee absent (or
   deletes an existing `AbsenceRecord`). Fine for HR-initiated
   corrections, terrible UX for the employee — they have to WhatsApp
   HR every time, HR loses the paper trail, and the fix doesn't
   actually populate a positive `AttendanceRecord` (payroll still
   sees the day as a gap unless HR does a follow-up DB touch).
2. **No path at all** for "add my missing clock-in/out". `AttendanceRecord`
   requires `clockInAt` non-null; the clock-out endpoint refuses to
   record without a matching clock-in event. So an employee who
   forgot both punches literally cannot make themselves visible in
   attendance history — they'd show as `ABSENT` until manually fixed
   via SQL.

We need a first-class, employee-initiated correction workflow with a
proper approval chain, notifications, and a materialized effect on
`AttendanceRecord` — so payroll sees the corrected day the same way
it sees a normal clock-in.

## Decision

### D1. New model `AttendanceCorrection` with single-level approval

Schema:

```
model AttendanceCorrection {
  id                    String   @id @default(cuid())
  companyId             String
  userId                String
  workDate              DateTime @db.Date
  requestedClockInAt    DateTime?
  requestedClockOutAt   DateTime?
  reason                String
  attachmentUrl         String?
  status                AttendanceCorrectionStatus  // PENDING_APPROVAL / APPROVED / REJECTED / CANCELLED
  supervisorId          String?    // snapshot @ submit
  decidedById           String?
  decidedAt             DateTime?
  decisionNote          String?
  createdAt             DateTime
  updatedAt             DateTime
  deletedAt             DateTime?
}
```

State machine:

```
PENDING_APPROVAL ──approve──► APPROVED   (writes AttendanceRecord)
                 ──reject───► REJECTED
                 ──cancel───► CANCELLED   (owner only)
```

**Single-level (not two-level like Leave)** because:

- The blast radius is one row on one day. A punch correction cannot
  overdraw a balance, cannot create a paid liability that didn't exist
  (the day is either present or absent — both are payroll-neutral in
  aggregate for time-based comp).
- A supervisor either knows or can quickly confirm whether the
  employee was there. Adding an HR gate creates drag and shifts
  accountability away from the person best positioned to verify.
- HR (or SUPER_ADMIN) can still decide — they're just not a required
  hop. This gives HR a natural escalation path for supervisors on
  leave / silent.

Rejected alternative: two-level approval mirroring Leave. Rejected on
UX grounds (see above). Team lead sign-off is enough proof.

### D2. `planCorrectionApply` is a pure decision function

The heart of the module is a framework-free function that takes the
current `AttendanceRecord` (or null) and the requested clock-in/out
times, and returns a discriminated action:

- `CREATE` — no record exists; create a fresh one.
- `PATCH`  — record exists; fill in null fields only.
- `NO_OP`  — record already matches the request (idempotent replay).
- `CONFLICT` — refuse with a specific reason code.

Reasons for the pure-function design:

- Unit-testable without a DB in the loop. All 15+ apply scenarios
  live in `apply-correction.spec.ts` and run in milliseconds.
- Deterministic ordering of checks — the codes we return
  (`CONFLICT_CLOCK_IN`, `CONFLICT_CLOCK_OUT`, `INVALID_TIME_ORDER`,
  `NO_TIMES_REQUESTED`) are stable and the FE can localize them.
- Zero surprises about "did the update just silently mutate more
  than I asked for?" — the plan is inspectable before it hits `tx`.

**Invariant: never silently overwrite a non-null field.** If the
requested clock-in differs from the existing non-null clock-in, we
return `CONFLICT_CLOCK_IN` rather than clobbering. Approvers reject
and the employee re-files with the correct value. Recovering from an
accidental overwrite is much harder than requiring a second submit.

### D3. On `CREATE`, look up the user's shift for that date

`AttendanceRecord.shiftId` is required. When the correction creates a
brand-new row, we look up `UserShiftAssignment` in effect on
`workDate`, falling back to the latest assignment if none matches.
When there's no assignment at all, we return `409 NO_SHIFT_ASSIGNMENT`
— HR fixes the assignment and the correction is re-decided.

Rejected alternative: allow `shiftId = null`. Rejected because it
would ripple through reports (which assume every attendance row has a
shift for late-minutes classification) and the fallback lookup is
cheap.

### D4. Geo sentinel `(lat=0, lon=0, accuracy=0)` for correction-created rows

Real clock-ins carry a GPS fix. A correction-created row has no such
fix — the employee is reporting the time hours or days later. We
store `(0, 0, 0)` as a documented sentinel. Reports that care
(geofence-quality dashboards, out-of-fence detection) can filter
`clockInAccuracyM = 0` to exclude these rows.

Rejected alternatives:

- **Nullable geo columns.** Would require a schema migration touching
  every existing report query. Sentinel + doc is cheaper for MVP.
- **Separate `source` column on `AttendanceRecord`.** Same schema
  concern; the audit trail is already reconstructible via `AuditLog`
  (`entityId = correction.id`).

### D5. `AbsenceRecord` deletion on `CREATE`

If the correction proves the employee was actually present, any
`AbsenceRecord` for `(userId, workDate)` must go — otherwise reports
would double-count as "present AND absent". The APPROVE transaction
deletes the absence in the same commit.

Rejected alternative: leave the absence in place with a "corrected"
flag. Rejected because the absence-scanner cursor logic + report
queries would need updates, and the natural semantics of "the
correction wins" cleanly justify the delete.

### D6. Attachment support via existing `AttachmentPurpose`

Extended `AttachmentPurpose` enum with `'attendance-correction'`.
Owner-check reuses the existing `isOwnedAttachmentKey` helper (with a
`purpose` parameter added). The key prefix
`attachments/attendance-correction/{companyId}/{userId}/…` prevents
cross-module key theft.

### D7. Payroll cutoff applies to submit AND cancel (not just decide)

Consistent with Leave/Overtime (Phase 18 refactor). Cancel is guarded
even though a PENDING correction has no payroll effect yet — otherwise
employees could retract PENDING requests to hide submissions from an
audit lookback of "what corrections were filed for the closed
period". Consistent-block > special-case.

### D8. No `source` field on `AttendanceRecord`

Considered adding `AttendanceSource` enum
(`CLOCK_IN` / `MANUAL_CORRECTION`) to trace provenance. Deferred
because:

- The audit story is already durable via `AuditLog`.
- Reports currently key off `clockInAccuracyM` heuristic (=0 =
  correction) without a dedicated column.
- Schema drift is a real cost; a `source` field would need seeded
  values, backfill migration, and update every report query.

If a future report explicitly needs "which rows came from corrections",
adding the column is a straightforward migration. YAGNI for now.

## Consequences

### Positive

- Employees have a self-service path to fix forgotten punches — the
  #1 real-world HR ticket goes away.
- Full audit trail: submit → decision → materialized change, all
  tied together via `AuditLog.entityId = correction.id`.
- Notifications close the loop: supervisor sees the queue, employee
  hears back with the decision + rationale.
- Payroll cutoff enforcement inherits from the shared helper — no
  drift risk vs. Leave/Overtime.

### Negative / trade-offs

- Geo sentinel (0/0/0) is a semi-magic value. Documented, but future
  contributors could miss the convention. Mitigation: unit test in
  `apply-correction.spec.ts` asserts the sentinel path.
- Single-level approval may frustrate HR teams used to two-level
  chains. Mitigation: HR can still decide directly (they're in the
  `SUPERVISOR | HR_MANAGER | SUPER_ADMIN` @Roles set), and the
  supervisor's approval is visible in `decidedById`.
- `CREATE` cannot compute `lateMinutes` / `earlyLeaveMinutes` (would
  require synthesizing a clock event + running the same classifier
  the clock-in endpoint uses). We store zeros and rely on the
  attendance re-classifier job (future work) or a manual HR touch-up.

### Follow-ups

- Re-classification job that recomputes `lateMinutes` /
  `earlyLeaveMinutes` for correction-created rows, comparing against
  the user's shift for that date.
- HR dashboard tile: "corrections awaiting decision (>3 days old)" to
  prevent supervisor bottlenecks.
- `POST /admin/company/reset-scanner-cursor` (still open from
  ADR-0010) — bundles well with a future correction-driven backfill.
