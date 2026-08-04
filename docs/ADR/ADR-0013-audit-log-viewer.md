# ADR-0013 — Audit Log Viewer (Read Surface for HR / Compliance)

- **Status:** Accepted
- **Date:** 2026-08-02
- **Deciders:** Backend, Frontend, HR/Compliance
- **Related:** ADR-0009 (manual absence override — writes
  `ATTENDANCE_MARK_ABSENT` / `ATTENDANCE_UNMARK_ABSENT`), ADR-0010
  (payroll cutoff — writes `COMPANY_CONFIG_UPDATED` and
  `SCANNER_CURSOR_RESET`), all leave/overtime/correction ADRs (writers
  of the respective `*_SUBMITTED / *_APPROVED / *_REJECTED /
  *_CANCELLED` rows).

## Context

`AuditLog` has been written on every sensitive mutation since day one:
leave decisions, overtime, absence override, correction workflow,
scanner cursor reset, company config updates. The schema is
append-only — the intended posture is `REVOKE UPDATE, DELETE ON
"AuditLog" FROM workpulse_app` at DB role level.

But HR / compliance have had **no way to read it** without asking a
DBA. This defeats the purpose. If an auditor asks "who approved this
leave?" or "when was the payroll cutoff changed last month?", we
should have a first-class read surface rather than raw SQL.

## Decision

### D1. Single endpoint, keyset pagination

`GET /api/v1/admin/audit-log?entityType&entityId&actorId&action&from&to&cursor&limit`

- All filters optional. Empty request returns the newest page.
- Pagination is **keyset over `(createdAt, id)`**, not offset. The
  `AuditLog` table can grow to millions of rows over years — offset
  pagination becomes O(N) at high page depths. Keyset stays O(log N)
  regardless of how deep the caller walks.
- Cursors are opaque base64url-encoded JSON blobs. Callers pass them
  back verbatim; server decodes + validates. A malformed cursor
  returns 400 `INVALID_CURSOR` rather than silently returning page 1
  (which would trap the caller in an infinite loop).
- Overfetch by 1 to detect "has more" without a separate COUNT.

### D2. Tenancy — strict, even for SUPER_ADMIN

Every query is `WHERE companyId = actor.companyId`. **SUPER_ADMIN has
no cross-tenant lane through this endpoint** — a SUPER_ADMIN identity
on tenant A cannot inspect tenant B's audit log here. Cross-tenant
investigation (platform incident review, etc.) escalates to direct
SQL access, which itself creates a trail on the DBA's session.

Rationale: an "admin can peek at any tenant" endpoint would be a
juicy target. Escalation via SQL keeps the blast radius contained
and requires physical access to the DB, which is a much stronger
signal for the audit team.

### D3. Actor join at query time, but no free-text search

We `select { actor: { fullName, email } }` in the same Prisma query
so the FE can render "HR Manager · hr@acme.test" without a second
lookup. Cost: one hash-join across `AuditLog` + `User`, cheap because
User is small and hot in cache.

We explicitly do NOT accept a free-text query (`?q=foo`). That would
either force a `LIKE '%foo%'` scan or require a `pg_trgm` index we
haven't provisioned. The existing filter set (entityType / entityId /
actorId / action / date range) maps cleanly to the two composite
indexes we already have:

- `(companyId, entityType, entityId)` — entity-scoped lookups.
- `(actorId, createdAt)` — "everything user X did" lookups.

If free-text becomes real ops pressure, revisit with a `pg_trgm`
index over `action` (small vocabulary, easy).

### D4. `beforeJson` / `afterJson` — generic diff, not typed per-action

Each writer stores an action-specific snapshot in these two fields.
We deliberately expose them as `unknown` in shared types and render
them via a **generic key-by-key shallow diff** on the FE (see
`components/features/admin/audit/audit-diff.tsx`).

Rationale: typing every action's snapshot would explode the type
surface and force a coordinated FE change every time a new writer
appears. A shallow diff catches the interesting cases in practice —
audit rows are typically flat objects (`{ status: 'APPROVED',
decidedById: 'u-1', note: '...' }`), not deep trees. If we ever add
a writer that stores nested payloads, we can special-case that
`action` in the FE renderer without touching the API.

### D5. Rate limiting

`Throttle({ limit: 30, ttl: 60_000 })` — lower than default because
this query is potentially expensive under wide-open filters. A
human at a keyboard cannot generate 30 pages per minute; a script
mining the log looks exactly like something we want to slow down.

### D6. Frontend surface

- `/admin/audit-log` linked from the admin subnav.
- Filter panel: entityType, action, actorId, entityId, from, to.
- Table: time, action, entity (type + id), pelaku (name + email), IP,
  Diff button.
- Row expansion is inline (not a drawer) — compliance workflows
  scroll up/down to compare related rows.
- "Muat lebih banyak" button fires the next `useInfiniteQuery` page.
- `useInfiniteQuery` queryKey excludes `cursor` so page-N doesn't
  invalidate page-1's render.

## Alternatives considered

1. **Offset pagination.** Rejected — O(N) at page depth, and the
   table WILL grow monotonically.
2. **Free-text search.** Rejected for MVP — requires `pg_trgm` and
   more careful throttling. Existing filters cover 90 % of use cases.
3. **Per-action typed snapshots** (`LeaveApprovedAudit`,
   `OvertimeApprovedAudit`, etc.). Rejected as maintenance drag —
   every new writer would need a matching type. Generic diff wins.
4. **Streaming NDJSON export.** Deferred — HR asked for browse, not
   export. Add later when the compliance workflow demands it.
5. **Cross-tenant SUPER_ADMIN lane.** Rejected on security grounds
   (see D2). Cross-tenant reads escalate to SQL.
6. **Write-side integration hooks** (emit domain event → separate
   store). Rejected as scope creep. The single-table read is fine.

## Consequences

- New module `apps/api/src/audit/` (`audit.service.ts`,
  `audit.controller.ts`, DTOs, module wiring in `app.module.ts`).
- No schema change — `AuditLog` already existed, indexes already
  cover the filter combinations we accept.
- The keyset cursor makes deep pagination cheap and predictable but
  disallows "jump to page N". This is a UX trade-off we're happy
  with: audit browsing is exploratory, not indexed by page number.
- `beforeJson` / `afterJson` shape is officially untyped from the FE
  perspective. Any future strict-mode refactor should keep them as
  `unknown` at the type boundary.

## Follow-ups

- **Distinct-values endpoint** (`GET /admin/audit-log/distinct?field=action`)
  to power an autocomplete dropdown in the filter panel driven by
  actual data instead of a static FE catalog. Nice to have; the
  static catalog covers the current dozen action codes.
- **Retention policy.** The append-only `AuditLog` will grow
  forever. Introduce a partition-based archival (`AuditLog_2027`
  detached and moved to cold storage) once the table crosses a few
  million rows. Not needed today.

### ✅ NDJSON export closed in Phase 26 (2026-08-02)

`GET /api/v1/admin/audit-log/export?entityType&entityId&actorId&action&from&to`
streams the caller-tenant's audit log as newline-delimited JSON. Same
filter set as the JSON list endpoint (no `cursor`/`limit` — the export
returns the full matching set up to the server-side cap).

Wire contract:

- `Content-Type: application/x-ndjson; charset=utf-8`
- `Content-Disposition: attachment; filename="audit-log-YYYY-MM-DD.ndjson"`
- `Cache-Control: no-store` + `X-Content-Type-Options: nosniff`
- One JSON object per line, `\n`-terminated. No BOM, no wrapping
  envelope, no trailing comma.
- Row shape matches `AuditLogRowDto` verbatim — the JSON list
  endpoint's rows plus `createdAt` as ISO string.

Design highlights (see `AuditService.iterate` + `AuditController.exportNdjson`):

- **Async generator with keyset iteration.** Same `(createdAt, id)`
  keyset as `list()`; batches `EXPORT_BATCH_SIZE = 500` rows per
  Postgres round-trip. Memory-bounded — the response never buffers a
  full result set.
- **Hard row cap `EXPORT_MAX_ROWS = 100_000`.** Beyond that the
  stream simply stops mid-file. A partial `.ndjson` is a legitimate
  answer — compliance callers who need more history chunk by
  `from`/`to`.
- **Aggressive throttle: 3 requests / minute / identity.** A human
  running one export a minute is fine; a bot mining the log runs
  into a wall.
- **Backpressure.** `res.write()` returning `false` awaits `drain`
  before scheduling the next Postgres batch. Without this a slow
  client can OOM the container by buffering 100k rows in Node's
  output buffer.
- **Client-disconnect handling.** Async generator naturally stops
  when the consumer drops (`.next()` never called). Also short
  circuits on `res.writableEnded` between rows.
- **`res.setTimeout(0)`** disables Node's default 5-minute response
  timeout. The reverse proxy is the only outer limit.
- **Tenancy stays strict.** Same `WHERE companyId = actor.companyId`
  guard as `list()`. SUPER_ADMIN still can't export another tenant's
  log through this endpoint.

Explicitly out of scope for MVP export:

- CSV / XLSX format. NDJSON is streamable, type-preserving (JSON in
  `beforeJson`/`afterJson` stays as JSON), and `jq`-friendly.
  Compliance tools can convert if needed.
- Multi-tenant SUPER_ADMIN export. Escalate via SQL as with the read
  lane.
- Async / job-based export. 100k rows streams in seconds; humans
  don't need "wait for email" UX at this scale.

### ✅ Row-level navigation — partially closed in Phase 24 (2026-08-02)

The original follow-up was "deep-link `entityId` to a detail page".
Investigating that showed the FE has **no detail pages** with
dynamic `[id]` segments today — every module is list-view only. So
we pivoted to a design that works with the current routing surface
while leaving room for future detail pages:

- **Click-to-filter**: `entityType`, `action`, `entityId`, and
  `actorId` cells in the audit log table double as buttons that
  patch the filter panel. Turns the table into a self-navigating
  explorer without needing detail routes.
- **External link icon** rendered only when
  `externalRouteFor(entityType, entityId)` returns non-null. Only
  `Company → /admin/company` is populated today. Adding new
  mappings is a one-line switch statement change in
  `audit-catalog.ts` — no API change required.
- **Static autocomplete catalog** (`KNOWN_AUDIT_ACTIONS`,
  `KNOWN_AUDIT_ENTITY_TYPES`) in the same file. Deliberately
  co-located with the FE (not in shared-types) — it's a soft hint,
  not a validation contract. Backend writers can add new action
  codes and the filter will still accept them; the codes just don't
  appear in the dropdown until the catalog is refreshed.

Remaining work — genuine deep-linking to per-entity detail pages —
lands whenever those detail pages actually get built (out of scope
for the audit log itself).
