# ADR-0032: DPIA (Data Protection Impact Assessment) Registry

- Status: Accepted
- Date: 2026-08-03
- Deciders: Engineering
- Phase: 31e

## Context

Fase 31d shipped the **ROPA** (Record of Processing Activities) registry.
GDPR Art. 35 and UU 27/2022 PDP Pasal 34 require a companion artefact for
high-risk processing: the **DPIA**. A DPIA:

- Documents the scope, necessity, and proportionality of a data-processing
  activity that is likely to produce high risk to individuals.
- Enumerates identified risks with quantified **likelihood × impact**
  scoring, mitigations, and a **residual** score after mitigations are in
  place.
- Records DPO opinion and the approver's sign-off, becoming immutable once
  APPROVED (superseded only by a newer APPROVED assessment).

Regulators expect a DPIA to be produced within hours during an audit — so
the domain must live in the system-of-record, not a spreadsheet.

## Decision

Ship a first-class DPIA module co-located with ROPA:

### Data model

- `DpiaAssessment` (one per attempt): title, scope, necessity, dpoOpinion,
  conclusion, status, FK to `RopaActivity`.
- `DpiaRiskItem` (many-per-assessment): title, description, likelihood,
  impact, inherentLevel, mitigations, residualLikelihood, residualImpact,
  residualLevel, ordinal.
- `DpiaStatus` enum: `DRAFT → REVIEW → APPROVED → ARCHIVED`.
- `DpiaRiskLevel` enum: `LOW | MEDIUM | HIGH | CRITICAL`.

### Invariants (DB-enforced)

- `residual{Likelihood,Impact}` ≤ `{likelihood,impact}` — a mitigation can
  never make a risk worse.
- All four axis columns ∈ `[1..5]` via CHECK constraint.
- **Partial unique index** `DpiaAssessment_one_approved_per_activity`:
  at most one `APPROVED` assessment per ROPA activity. The service
  auto-archives the previous APPROVED inside the same transaction as it
  approves a new one.

### Bucketing

`likelihood × impact` produces a score in `[1..25]`:

| Score | Level    |
| ----- | -------- |
| <8    | LOW      |
| 8..14 | MEDIUM   |
| 15..19| HIGH     |
| 20..25| CRITICAL |

Thresholds match ENISA guidance for public-sector DPIAs. The DB stores the
bucket as an enum for cheap reads, but the (likelihood, impact) columns
remain the source of truth — the bucket is recomputed on every write via
`domain/risk-scoring.ts`.

### Lifecycle

1. `DRAFT` — editable; risk items mutable.
2. `REVIEW` — frozen; must return to draft to edit.
3. `APPROVED` — immutable; auto-archives previous APPROVED.
4. `ARCHIVED` — historical.

Approve is only legal from `REVIEW` and requires at least one risk item
(`DPIA_HAS_NO_RISK_ITEMS`) — matching the "no DPIA without a risk
register" rule from GDPR guidance.

### Audit trail

Every mutation writes an `AuditLog` row inside the same `$transaction`:
`DPIA_CREATED`, `DPIA_UPDATED`, `DPIA_SUBMIT_REVIEW`,
`DPIA_RETURN_TO_DRAFT`, `DPIA_APPROVE`, `DPIA_RISK_ADDED`,
`DPIA_RISK_UPDATED`, `DPIA_RISK_REMOVED`, `DPIA_EXPORTED`.

### Export

PDF only for 31e (`GET /admin/dpia/assessments/:id/export.pdf`). Follows
the audit-before-stream pattern:

1. Buffer the entire PDF in memory (bounded — a DPIA has ≤ dozens of
   risks).
2. `sha256(bytes)`.
3. Write `DPIA_EXPORTED` audit row with the hash + byte length.
4. Only then return the bytes.

If step 3 fails the caller receives no bytes.

### RBAC

`HR_MANAGER` and `SUPER_ADMIN` only. Employees + supervisors do not get
DPIA read access — the risk register regularly enumerates real security
weaknesses.

## Alternatives Considered

**Extend ROPA versions with risk items** — rejected. ROPA versions are
the register of *what* is processed; DPIA is the assessment of *how much
risk that processing carries*. Mixing them explodes the ROPA payload and
forces the schema to accommodate risk-only fields on activities that do
not need a DPIA.

**Free-form text without scoring** — rejected. The regulator asks for
before/after numbers, not prose. Structured scoring also lets us
aggregate risk in the exec dashboard later.

**Custom per-tenant risk grids** — deferred. Every tenant we spoke to
would happily start with the ENISA 5×5 grid. A per-tenant override table
is trivial to add later; shipping it now would double the QA surface.

**PDF + XLSX both in 31e** — deferred. The DPO reviewer workflow needs
paper (PDF); machine consumption (XLSX) is not requested in the
compliance survey. Ship it later once we have consumer signal.

## Consequences

### Positive

- Complete DPIA workflow in-system — audit-ready inside a single
  transaction.
- Residual ≤ inherent enforced both at DB and service layer.
- One-APPROVED-per-activity invariant enforced by DB — no race hole.
- PDF export SHA-256 auditable — regulator can prove the same bytes
  they saw.

### Negative

- Manual data entry — no auto-populate from ROPA fields. Deliberate:
  DPIA is a risk *analysis*, not a copy of the register.
- Requires a manual approver step per DPIA — no bulk approve. Also
  deliberate: bulk approve would defeat the compliance purpose.

## Rollback

Feature is additive:

- `DROP TABLE "DpiaRiskItem", "DpiaAssessment";`
- `DROP TYPE "DpiaStatus", "DpiaRiskLevel";`
- Delete `apps/api/src/dpia/**` and FE surface `/admin/dpia`.

No other module reads DPIA state — ROPA does not depend on it.

## References

- GDPR Art. 35 (Data Protection Impact Assessment).
- UU 27/2022 PDP Pasal 34.
- ENISA "Guidelines for SMEs on the security of personal data
  processing" (risk-level bucketing).
- ADR-0030 (ROPA registry) — parallel workflow.
