# ADR-0021 — Right to erasure (UU PDP / GDPR Article 17)

- **Status:** Accepted
- **Date:** 2026-08-02
- **Owners:** Platform / Privacy WG

## Context

UU Perlindungan Data Pribadi (UU PDP) Pasal 27 and GDPR Article 17
give a data subject the right to obtain **erasure** of their personal
data. Workpulse already ships data-portability (Fase 31a, ADR-0020);
the erasure counterpart is Fase 31b.

An HR system is not free to `DELETE FROM user` on request — a
former employee's **attendance, leave, overtime, and audit records**
must survive for the retention window mandated by UU Ketenagakerjaan
and tax law (7–10 years). Regulators explicitly recognise this
tension and accept **pseudonymisation / anonymisation of personal
data** as a lawful substitute for physical deletion when a
retention obligation applies.

We also need an approval gate: a rogue actor who compromises a
single employee session should not be able to erase the target user
unilaterally.

## Decision

Ship a two-stage workflow: **request → HR/Admin approval →
worker-driven anonymisation**, with a grace window in the middle
that lets the user cancel.

### State machine

```
PENDING_APPROVAL ─(HR or Admin approves)─► APPROVED_SCHEDULED
      │                                             │
      │(HR/Admin rejects, note required)            │(user cancels)
      ▼                                             ▼
    REJECTED                                    CANCELLED
                                                    │
                                                    │(worker, after `scheduledFor`)
                                                    ▼
                                                 EXECUTED (or FAILED)
```

- Only **HR_MANAGER** or **SUPER_ADMIN** can approve or reject
  (either role suffices — a small tenant should not be blocked when
  their only HR is out).
- **Approver ≠ target**. The service refuses `ERASURE_SELF_APPROVAL`
  so a compromised HR account cannot erase itself + the audit trail.
- Grace period defaults to **7 days** (`DATA_ERASURE_GRACE_DAYS`,
  clamped 1–30). Approving does not execute immediately.
- Only the target user can cancel while `APPROVED_SCHEDULED`.
- The row is kept **forever** — even after `EXECUTED` — so audit
  investigations can trace who decided what and when.

### Anonymisation contract (`domain/anonymize-user.ts`)

Runs inside a single Prisma `$transaction`. What changes:

- `User.email` → `erased-<userId>@workpulse.deleted` (globally
  unique, non-routable domain).
- `User.fullName` → `Erased User`.
- `User.passwordHash` → 64 random bytes hex — unusable, never
  accidentally logs the user back in.
- `User.mfaSecret`, `mfaEnabledAt` → `NULL`.
- `User.mustChangePassword` → `false`.
- `User.employmentStatus` → `TERMINATED`, `deletedAt` → now.
- Every `MfaBackupCode`, `PasswordResetToken`,
  `NotificationPreference`, and `Notification` row is **deleted**.
- Every `RefreshToken` row is set to `status=REVOKED`. Sessions on
  every device drop on the next 401.
- Open `DataExportRequest` rows are flipped to `EXPIRED` and their
  `fileKey` is nulled. The S3 objects themselves are deleted
  **out-of-transaction** by the service to avoid holding an HTTP
  round-trip inside a DB tx.

What is **kept** on purpose:

- `AttendanceRecord`, `AttendanceEvent`, `AbsenceRecord`,
  `AttendanceCorrection` — tax + labour-law retention.
- `LeaveRequest`, `LeaveBalance`, `OvertimeRequest`.
- `UserShiftAssignment`.
- `AuditLog` rows where the erased user was actor — compliance
  evidence.

The `DataErasureRequest` row itself is retained. Its FK on `userId`
is `Restrict`, not `Cascade`, so the erasure decision outlives any
future manual purge of the user.

### Worker (`DataErasureWorker`)

- `@Cron('0 */5 * * * *')` — every 5 minutes.
- Claim query uses `SELECT ... FOR UPDATE SKIP LOCKED` on
  `status = 'APPROVED_SCHEDULED' AND scheduledFor <= NOW()`, so
  multi-replica APIs never step on each other.
- Bounded loop of 5 rows per tick to avoid starving the scheduler.
- On error the row flips to `FAILED` in a fresh transaction and an
  audit entry is written; the next tick does NOT retry
  automatically — a human decides whether to re-queue.

### API surface

Self-service (`/me/data-erasure`):

- `POST /` — create request. 409 if an active row exists.
- `GET /` — list caller's history (25 most recent).
- `POST /:id/cancel` — cancel while `PENDING_APPROVAL` or
  `APPROVED_SCHEDULED`.

Admin (`/admin/data-erasure`, `RolesGuard(HR_MANAGER, SUPER_ADMIN)`):

- `GET /pending` — queue (both `PENDING_APPROVAL` and
  `APPROVED_SCHEDULED`) with requester name + email hydrated.
- `GET /` — full history (100 most recent).
- `POST /:id/approve` — decision note optional.
- `POST /:id/reject` — decision note **required**
  (`ERASURE_REJECT_NOTE_REQUIRED` otherwise).

### Notifications

Four new `NotificationType` values (in-app + email):

- `DATA_ERASURE_REQUESTED` — to every HR + Admin of the tenant on
  create.
- `DATA_ERASURE_APPROVED` — to the target on decision.
- `DATA_ERASURE_REJECTED` — to the target with the decision note.
- `DATA_ERASURE_EXECUTED` — to HR + Admin after anonymisation
  (target's notifications were wiped, so we don't email `erased-*`).

Emails go through the same `EmailAdapter` used by every other
notification. Delivery failures are logged and never roll back the
business transaction.

### Frontend

- `/settings/privacy` gains a `PrivacyErasurePanel` with a
  two-step confirmation: user must (a) tick an "I understand"
  checkbox AND (b) type the word `HAPUS`. The submit button
  polls for status every 10 s while a request is in flight.
- `/admin/privacy/erasure-requests` — HR / admin queue with an
  Antrian / Semua toggle, approve + reject actions (reject requires
  a note in a small inline form).

### E2E test-support endpoints

Gated on `THROTTLER_DISABLED=true` — refused when
`NODE_ENV=production`.

- `POST /test-support/data-erasure/prune` — delete rows for a user.
- `POST /test-support/data-erasure/fast-forward` — set
  `scheduledFor` to the past.
- `POST /test-support/data-erasure/tick` — kick the worker inline
  instead of waiting 5 minutes.

## Consequences

### Positive

- UU PDP + GDPR Art. 17 coverage without weakening the
  business-records retention guarantee.
- Full audit trail: every state transition writes to `audit_logs`.
- Concurrency-safe worker across replicas.
- Test-support harness lets the CI run the full lifecycle in
  seconds.

### Negative / trade-offs

- Erased users cannot log in — obvious, but also means we cannot
  retro-actively let the same person "un-erase". A new user row
  under a different email is the only recovery path. This matches
  what regulators expect.
- The row-level retention decision is not per-record configurable
  in this ADR — everything on the "kept" list stays. Fase 31c
  (retention automation) will add tenant-level knobs.
- 5-minute worker cadence introduces up to a 5-minute latency
  between "scheduled" and "actually erased". Acceptable for a
  right-that-triggers-once-per-person workflow.

## Alternatives considered

- **Hard delete.** Rejected: violates UU Ketenagakerjaan Article 78
  (payroll-record retention) and audit obligations.
- **Single-role gate (HR_MANAGER only).** Rejected: leaves small
  tenants with a single HR completely blocked when that HR is on
  leave. Adding SUPER_ADMIN as an alternate approver preserves
  separation of duty (the requester can never be their own
  approver).
- **Immediate execution on approve.** Rejected: gives the user zero
  ability to walk back a request they changed their mind about,
  and increases the blast radius of a compromised HR session.

## Related

- ADR-0006 — Audit log immutability
- ADR-0017 — MFA / TOTP enrollment (encrypted secrets)
- ADR-0020 — Data-portability / DSAR
- `docs/WORKFLOW.md` §0.14
