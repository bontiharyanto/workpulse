# ADR-0025 — Timesheet Payroll Export (Fase 32c)

## Status
Accepted — 2026-08-03

## Context

Fase 32a materialised timesheets, Fase 32b added a two-tier approval
workflow (Supervisor → HR Manager). Payroll needs a way to hand off
those `APPROVED` timesheets to an external system (Excel-based payroll,
imported into an accounting suite, or shipped to a payroll BPO).

Requirements:

1. **Two file formats.** CSV (universal, easy for a scripted importer)
   and XLSX (human-friendly with a title block, HR routinely opens the
   result before forwarding).
2. **Two granularities.** SUMMARY (one row per user × period — the
   payroll roll-up) and DETAIL (one row per `TimesheetEntry` — needed
   for spot-checks and dispute resolution).
3. **Only APPROVED rows.** Exporting DRAFT or PENDING data would ship
   numbers that can still legally change; treating "APPROVED" as the
   sole eligible state keeps the payroll pipeline consistent with the
   workflow invariants added in Fase 32b.
4. **Full audit trail.** For every export we must be able to answer
   later: *"who exported what, when, in what shape, and was the file
   the payroll team received actually the file we produced?"*.
5. **Cross-tenant safety.** HR of Company A must never see or export
   any bytes of Company B — same discipline as the rest of the app.

## Decision

### 1. `TimesheetExport` table with SHA-256 payload seal

We introduce a new Prisma model:

```
TimesheetExport {
  id, companyId, periodId, requestedById,
  format (CSV|XLSX), mode (SUMMARY|DETAIL),
  departmentId?, rowCount, entryCount, bytes,
  payloadSha256,   -- fixed-length hex, 64 chars
  note?,
  createdAt
}
```

`payloadSha256` is computed over the **exact byte-string** that leaves
the server. Both the audit row AND the HTTP response header
`X-Payload-Sha256` carry it, so the payroll team can compare the file
they received against what our audit trail claims.

The table is **append-only**: the migration issues
`REVOKE UPDATE, DELETE ON TABLE "TimesheetExport" FROM PUBLIC` to
guarantee that even a rogue service code change can't silently rewrite
export history against the application role.

### 2. Audit-before-stream ordering

Inside `TimesheetExportService.export()`:

```
1. RBAC gate (HR_MANAGER or SUPER_ADMIN).
2. Load timesheets with status=APPROVED for the tenant+period.
3. If empty → 400 EXPORT_EMPTY.
4. Serialise to Buffer (CSV or XLSX).
5. Compute SHA-256 of the buffer.
6. INSERT TimesheetExport + AuditLog in the same transaction.
7. Only THEN send bytes to the client.
```

If the audit insert fails, the client never sees the file. The audit
row is the source of truth even when the file itself is later deleted.

Trade-off: we buffer the full payload in memory instead of streaming.
Payload size is bounded by tenant `#users × entries-per-period`; for
the largest tenants we've modelled (~2 000 users × ~62 daily entries
in DETAIL mode) the XLSX comes in under 8 MB. Streaming a hash + tee
to the response is possible but adds complexity for negligible RAM
saving.

### 3. Frozen column order + numeric handling

Column order is exported from `payroll-rows.ts` as
`SUMMARY_COLUMNS` / `DETAIL_COLUMNS` `Object.freeze`d arrays.
External payroll systems parse CSV by column index, so **never reorder
columns**; add new ones at the end. Bumping order requires a follow-up
ADR.

CSV specifics:

- UTF-8 with BOM (`\uFEFF`) so Excel on Windows opens it correctly.
- CRLF line endings (RFC-4180).
- Fields containing `"`, `,`, `\r`, or `\n` are quoted, with doubled
  internal quotes.
- Numbers are unquoted; nulls become empty strings.

### 4. RBAC + throttle

- `@Roles('HR_MANAGER', 'SUPER_ADMIN')` on the controller — mirrors
  the report controller's decision.
- `@Throttle({ default: { limit: 10, ttl: 60_000 } })` — payroll runs
  once per period; 10/min is a comfortable ceiling to prevent scripted
  brute-forcing of the audit trail.

### 5. No payroll lock at DB level (yet)

We considered auto-locking a period on first export ("no more workflow
transitions after export"). Rejected for MVP because:

- HR still needs to be able to re-open a period if payroll finds a
  discrepancy that requires an `AttendanceCorrection`. Fase 32b already
  refuses corrections on APPROVED timesheets, which is the actual
  concurrency risk.
- If we ever add hard payroll lock, it's an additive migration.

## Consequences

**Positive**

- Byte-exact audit trail is now the source of truth for payroll
  hand-offs — legal / compliance can prove intent even after files
  age out.
- CSV is machine-readable and Excel-friendly; XLSX includes a title
  block for human reviewers.
- Frozen column contracts protect integrations from silent breakage.

**Negative / limitations**

- Full-payload buffering caps sensible export size at a single
  process's heap. If we grow past ~50 MB per export we'll need to
  switch to a streaming-hash pattern (`crypto.createHash().update()` on
  each chunk).
- `TimesheetExport.payloadSha256` is *not* a signature — we don't sign
  with a private key. A rogue superuser with DB access can still forge
  history. Acceptable for internal payroll where DB access is already
  audited at the infrastructure layer.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Presigned S3 URL per export | Adds infra dependency for a workflow that's essentially "download and forget". Reintroduce if payroll starts asking for shareable long-lived links. |
| PDF export | Not machine-readable by payroll systems; HR's habit is spreadsheet-native. |
| Async job + email | Payroll is a synchronous, deliberate action ("HR opens the panel, clicks export"). Adding an async layer only helps if we need >1 min renders — we're at ~1 s for the largest modelled tenant. |
| Locking the period on export | Would prevent legitimate re-exports for spot corrections. See §5 above. |

## References

- ADR-0023 — Timesheet Foundation
- ADR-0024 — Timesheet Submission Workflow
- WORKFLOW.md §11.14 — Payroll export playbook
- `apps/api/src/timesheet/timesheet-export.service.ts`
- `apps/api/src/timesheet/renderers/csv-renderer.ts`
- `apps/api/src/timesheet/renderers/xlsx-renderer.ts`
