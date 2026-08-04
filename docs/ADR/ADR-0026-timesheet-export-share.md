# ADR-0026 — Timesheet export share links (Fase 32d)

## Status

Accepted — 2026-08-03.

## Context

Fase 32c gave HR / Super Admin an endpoint that streams payroll CSV / XLSX
downloads and audits every hit with a SHA-256 of the emitted bytes. In
practice the payroll team is usually an _external_ vendor — they receive
the file via email or a shared drive and never touch Workpulse. Two
frictions came out of the first cutover:

1. **Manual re-emailing.** Every time HR ran an export they had to
   download it, attach it to an email, and hope the vendor received the
   same bytes. If the vendor lost the file HR had to redo the whole
   dance.
2. **No cryptographic proof of what the vendor got.** The audit row
   proved _"HR downloaded X bytes at time T"_, but nothing tied that to
   the vendor's actual download.

We want HR to press a "Bagikan" button and receive a signed URL that:

- Can be pasted into an email to the vendor.
- Expires (default 24 h).
- Is verifiable server-side with no JWT / cookie session.
- Every anonymous fetch bumps a counter + writes an audit row.
- Can be revoked instantly.

## Decision

### 1. Signature scheme

- Add env `TIMESHEET_EXPORT_SIGNING_SECRET` (min 32 bytes,
  base64-friendly, mandatory in prod, ephemeral random in dev).
- URL carries `?id=<shareId>&expires=<unixMs>&signature=<b64url>`.
- `signature = base64url(HMAC_SHA256(secret, "${shareId}:${expires}"))`.
- Verifier reconstructs the MAC, uses `timingSafeEqual`, then checks
  expiry _only after_ the MAC check (so a "valid-but-expired" URL cannot
  be distinguished from "invalid signature" by timing).
- All verify-failure branches return a generic 403 to the client;
  specific reason is logged server-side.
- Rotating the secret invalidates every issued URL globally — that IS
  the incident response for a leaked link.

### 2. Data model — `TimesheetExportShare`

Append-only row that records HR's intent:

```
id, exportId, companyId, createdById, expiresAt, revokedAt?, revokedById?,
downloadCount, lastDownloadedAt?, note?, createdAt
```

- `revokedAt` is a soft flag — the URL keeps verifying cryptographically
  but the DB gate refuses. That way we can audit "vendor tried after
  revoke".
- `downloadCount + lastDownloadedAt` are the only fields ever updated;
  we keep DELETE revoked at the DB layer so the audit history is
  tamper-evident.

### 3. Byte-identical downloads — payload persistence

**Problem:** re-rendering XLSX is non-deterministic (ExcelJS embeds
`Date.now()` into ZIP entries), so a "re-render on demand and prove the
hash still matches" approach doesn't work for the XLSX branch.

**Chosen approach:** persist the exact byte-string on
`TimesheetExport.payload` (bytea, nullable for pre-32d rows). The share
service loads that column and streams it verbatim after cross-checking
`sha256(payload) === payloadSha256`. If the check fails we refuse with
500 `EXPORT_PAYLOAD_CORRUPTED` — this can only happen if someone
tampered with the DB directly.

**Rejected alternatives:**

- **Re-render on download.** Fails XLSX determinism as above; would
  force CSV-only sharing.
- **Store payload in S3.** Adds infra dependency and a new failure mode
  (S3 permissions drift, cross-region latency) for a bounded-size
  artefact (~10 MB worst case for a 500-employee company / month).
- **Store payload in the audit log JSON.** Would balloon the audit log
  size and mix binary + text in a column intended for structured JSON.

**Trade-off accepted:** persisted payroll bytes in Postgres. Same
retention posture as other `TimesheetExport` audit rows — tenant-scoped,
Fase 31c retention worker sweeps them by age. Legacy rows (pre-32d,
`payload IS NULL`) refuse share creation with 410 `EXPORT_PAYLOAD_UNAVAILABLE`.

### 4. Public endpoint

- Route: `GET /api/v1/public/timesheet-exports/download?id&expires&signature`.
- `@Public()` — no JWT required.
- Aggressive throttle: 60 hits/min per IP (via `@Throttle`), sized for a
  handful of legitimate downloads per share.
- Emits `X-Payload-Sha256` and `X-Export-Id` response headers so vendors
  can wire integrity checks into their own pipeline.
- `Cache-Control: no-store` so intermediary caches never hold payroll
  bytes.

### 5. Admin endpoints

Nested under the export ID so RBAC + tenant scoping reuse the export
row's guards:

- `POST /admin/timesheet/exports/:id/shares` → create + return signed URL.
- `GET  /admin/timesheet/exports/:id/shares` → list share rows.
- `POST /admin/timesheet/exports/:id/shares/:shareId/revoke` → soft
  revoke, idempotent.

### 6. Audit events

Three new actions on `AuditLog`:

- `TIMESHEET_EXPORT_SHARED` (actor = HR).
- `TIMESHEET_EXPORT_SHARE_REVOKED` (actor = HR).
- `TIMESHEET_EXPORT_SHARE_DOWNLOADED` (actor = **null** — anonymous
  vendor). We record the IP address in `afterJson` so an operator can
  correlate suspicious download bursts.

## Consequences

**Positive:**

- HR gets a one-click "bagikan" flow with an auditable trail.
- Vendors receive the exact bytes HR saw, provable via `X-Payload-Sha256`.
- Compromise of a single link is fixable by revocation; compromise of
  the signing secret is fixable by rotation.
- No new infra (no S3, no auth server, no separate download service).

**Negative:**

- Storing payloads in Postgres raises row-storage cost for exports.
  Bounded per tenant and pruned by retention worker, so acceptable.
- Rotating `TIMESHEET_EXPORT_SIGNING_SECRET` invalidates all issued
  links. Operators must warn HR before rotation.
- Public endpoint expands the attack surface. Mitigated by aggressive
  throttling, generic 403 responses, and audit logging.

## Related

- Fase 32c — ADR-0025 (payroll export CSV / XLSX).
- Fase 31c — retention worker sweeps expired share rows + old export
  payloads.
