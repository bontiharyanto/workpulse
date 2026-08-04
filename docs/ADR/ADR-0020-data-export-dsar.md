# ADR-0020 — Data Subject Access Request (self-service DSAR)

- **Status:** Accepted
- **Date:** 2026-08-02
- **Phase:** 31a
- **Related:** ADR-0018 (Session management), ADR-0019 (Email transport & security headers)

## Context

UU Perlindungan Data Pribadi (UU PDP, Ind.) and GDPR Art. 15 grant every
data subject the right to receive a portable copy of their personal
data. Workpulse holds attendance, leave, overtime, notifications,
sessions, and audit rows that all qualify as personal data. Prior to
Fase 31 we had no self-service surface — a request had to be honoured
by HR through database access, which is neither auditable nor
scalable.

We need a background job pipeline: assembling a full export can take
seconds to tens of seconds and MUST NOT run in the HTTP request path.
We also need bounded rate limiting because the assembler touches every
domain table and produces MB-scale archives.

## Decision

Introduce a `DataExportRequest` table + `/me/data-export` controller

- `DataExportWorker` cron job. The user-facing lifecycle is:

```
POST /me/data-export         (creates PENDING row + audit)
        │
        ▼
[worker cron every 30s] claims via SELECT ... FOR UPDATE SKIP LOCKED
        │
        ▼
      PROCESSING (startedAt set)
        │
        ▼
   assembleExportArchive(prisma, …)  → ZIP Buffer in memory
        │
        ▼
   storage.putObject(key, body)      → data-exports/{co}/{user}/{req}.zip
        │
        ▼
      READY (fileKey, fileSize, expiresAt = now + 24h)
        │
        ▼   (24 h later)
   [worker cron 03:15 UTC daily] expireOverdue()
        │
        ▼
      EXPIRED  (fileKey wiped, S3 object deleted, audit row appended)
```

Failure branch (assembler or upload throws):

```
      PROCESSING ─► FAILED (failedAt, failureReason)
```

## Wire contract

Every route is scoped to the caller by `@CurrentUser()`. There is no
admin / HR variant — DSAR is by definition a first-party right.

- `POST /me/data-export` → 201
  - `{ id, status, requestedAt, completedAt, failedAt, failureReason, fileSize, expiresAt, downloadUrl: null }`
  - `409 EXPORT_ALREADY_PENDING` when a PENDING/PROCESSING row exists.
  - `409 EXPORT_COOLDOWN` (with `details.nextAllowedAt`) when the last
    request landed within `DATA_EXPORT_COOLDOWN_HOURS` (default 24 h).
  - Layered throttle: `@Throttle({ default: { limit: 5, ttl: 3_600_000 } })`
    to blunt broken client scripts that would otherwise generate audit
    noise even for rejected attempts.
- `GET /me/data-export` → `{ requests: DataExportRequestDto[] }`.
  `downloadUrl` is always `null` on list; the FE must call the
  dedicated download route to mint one. That keeps stale URLs out of
  bookmark bars.
- `GET /me/data-export/:id/download` → `{ downloadUrl, expiresIn }`.
  Mints a fresh presigned S3 GET each call.
  - `404 EXPORT_NOT_FOUND` for foreign IDs (no existence leak).
  - `409 EXPORT_NOT_READY` for PENDING/PROCESSING.
  - `409 EXPORT_FAILED` (with `details.failureReason`) for FAILED.
  - `410 EXPORT_EXPIRED` when the row has been swept.
  - Throttle: `30 per 60_000` — plenty for retries, low enough to
    catch a stuck FE spinlock.

## Data model

```prisma
enum DataExportStatus {
  PENDING PROCESSING READY FAILED EXPIRED
}

model DataExportRequest {
  id            String @id @default(cuid())
  userId        String
  companyId     String
  status        DataExportStatus @default(PENDING)
  requestedAt   DateTime @default(now())
  startedAt     DateTime?
  completedAt   DateTime?
  failedAt      DateTime?
  failureReason String?
  fileKey       String?
  fileSize      Int?
  expiresAt     DateTime?

  @@index([userId, requestedAt])
  @@index([status, requestedAt])   // supports the worker claim query
  @@index([companyId, status])
}
```

## Design highlights

1. **Worker claim uses `FOR UPDATE SKIP LOCKED`.** Multiple API
   replicas can safely run the same worker without stepping on each
   other. A slow assembly holding one row does not block a second
   worker from picking a different row. If the worker crashes
   mid-transaction, the row rolls back to `PENDING` and the next
   tick reclaims it.

2. **Cooldown is a business rule, not a throttler concern.** The
   24-hour window is long enough that we cannot express it via
   `@nestjs/throttler` (which is designed for burst limits under a
   minute). We enforce it in the service layer and let the throttler
   catch abuse-scale bursts.

3. **Presigned URLs minted on demand, never persisted.** The list
   endpoint carries `downloadUrl: null` intentionally. Fetching the
   download route mints a URL bound by `S3_PRESIGN_GET_TTL_SECONDS`.
   Users who screenshot the settings page never leak a live URL, and
   URL revocation is implicit — after the TTL, the URL is dead.

4. **Redactions are explicit, not implicit.** The archive's
   `README.txt` and `security.json` list what we deliberately did NOT
   include: `passwordHash`, `mfaSecret`, `refreshToken.tokenHash`,
   `mfaBackupCode.codeHash`, `passwordResetToken.tokenHash`. Absent-vs-
   omitted must be discoverable so an auditor can tell the difference
   from a hostile "we tried to hide it" story.

5. **The archive is small and buffered in memory.** Even after five
   years of daily attendance, an employee's data caps out around a few
   MB. Streaming to S3 introduces Content-Length signing complexity
   we don't need. If usage patterns change, this decision is trivially
   reversible (`archiver` supports streaming out of the box).

6. **Retention is enforced by the same worker.** A `@Cron('15 3 * * *')`
   handler flips `READY` rows older than 24 hours to `EXPIRED` and
   deletes the S3 object. The audit log records each expiry.

## Frontend surface

`/settings/privacy` renders `DataExportPanel`:

- One-tap "Ajukan ekspor data" button. Disabled while any
  PENDING/PROCESSING row is visible.
- Table of past requests, newest-first, capped at 25.
- Polling: TanStack Query with `refetchInterval` set to 5 s while any
  row is in-flight, `false` otherwise — so an idle panel is free.
- Download → API returns fresh presigned URL → FE calls
  `window.location.assign(...)`. The URL is never persisted in FE
  state or router history.

Error copy is localised in Indonesian and mapped from the API's
machine codes (`EXPORT_COOLDOWN`, `EXPORT_ALREADY_PENDING`, etc.).

## Security

- **Tenant / RBAC scoping.** Every DB read is filtered by
  `userId` — the archive assembler double-checks even on tables
  where the FK already implies isolation. Cross-user download attempts
  return `404` (not `403`) to avoid existence oracles.
- **Presigned URL blast radius.** Bound by
  `S3_PRESIGN_GET_TTL_SECONDS` (default 3600). Even if a URL leaks in
  a browser history dump, it dies with the TTL.
- **Audit trail.** Every state transition writes to `AuditLog`:
  `DATA_EXPORT_REQUESTED`, `DATA_EXPORT_COMPLETED`,
  `DATA_EXPORT_FAILED`, `DATA_EXPORT_DOWNLOAD_URL_ISSUED`,
  `DATA_EXPORT_EXPIRED`. These are immutable per
  `docs/ARCHITECTURE.md` §Audit.
- **Test-support gate.** The `test-support/data-export/prune` route
  exists only for E2E and refuses to run unless
  `THROTTLER_DISABLED=true` — the same env flag `env.validation.ts`
  refuses in production.

## Ops considerations

- **Env vars added** (see `.env.example`):
  - `DATA_EXPORT_COOLDOWN_HOURS` (default 24)
  - `DATA_EXPORT_WORKER_ENABLED` (default `true`)
- **Kill switch.** Setting `DATA_EXPORT_WORKER_ENABLED=false` on a
  given API instance disables cron processing. New requests still
  enqueue as PENDING — useful when running the worker on a dedicated
  worker pool.
- **Scaling.** The cron ticks every 30 s and processes up to 5 jobs
  per tick per instance. At scale, run more instances or shorten the
  tick — the `SKIP LOCKED` semantics keep contention free.
- **Storage cost.** With a 24 h retention, at most one archive per
  active user is stored at any time. 10 k users × 5 MB average = 50 GB
  peak S3 footprint. Retention is enforced by the daily sweep.

## Tradeoffs / open items

- **No job priority.** All requests are FIFO. If a workload skew ever
  matters, add a `priority INTEGER DEFAULT 0` column and a
  `ORDER BY priority DESC, requestedAt ASC` claim.
- **`archiver` in memory.** Assumes single-user archives fit in RAM.
  We picked 5 MB as an implicit ceiling; in practice they run
  ~10 KB after gzip. If a single user's data ever exceeds ~50 MB,
  switch to streaming (`archiver` supports it) — the interface stays
  the same.
- **Retention sweep is best-effort.** If S3 delete fails, the row is
  still marked EXPIRED and `fileKey` cleared. A separate ops task
  can reconcile the bucket if needed. This is a deliberate choice:
  an audit consumer looking at the DB should never see a "READY row
  older than 24 h" — the DB is the source of truth for state, S3 is
  the source of truth for the bytes.

## Verification

- Unit: `data-export.service.spec.ts` (rate limit, transitions, 4 error codes, retention sweep).
- Unit: `data-export.worker.spec.ts` (`FOR UPDATE SKIP LOCKED` claim, kill switch, happy path, failure path).
- Unit: `domain/assemble-export.spec.ts` (ZIP magic bytes, userId scoping, audit cap, README redactions).
- E2E API: `tests/data-export.spec.ts` (happy path with real MinIO upload, cooldown, cross-user 404, list scoping).
- E2E UI: `tests/data-export-ui.spec.ts` (empty state, click → READY → download, cooldown alert).
