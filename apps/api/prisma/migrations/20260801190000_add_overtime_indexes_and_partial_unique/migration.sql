-- =============================================================================
-- Migration: add_overtime_indexes_and_partial_unique
-- -----------------------------------------------------------------------------
-- Adds two indexes to `OvertimeRequest` that the init migration missed:
--
--   1. A plain btree on (status, workDate) — supports the daily completion
--      scheduler's linear scan:
--
--        SELECT ... FROM "OvertimeRequest"
--        WHERE  status = 'APPROVED'
--          AND  deletedAt IS NULL
--          AND  workDate >= now() - INTERVAL '90 days'
--        ORDER BY workDate ASC, createdAt ASC
--
--      Without this, the scan degrades to a full table scan once the request
--      corpus grows beyond a few thousand rows. This index is tracked by
--      Prisma via `@@index([status, workDate])` in schema.prisma.
--
--   2. A **partial unique** index on (userId, workDate) restricted to active
--      states. Defense-in-depth against a concurrent-submit race: two API
--      workers submitting overtime for the same (user, workDate) at the exact
--      same time could both pass the app-level "duplicate check" inside their
--      own transactions and both INSERT successfully. This partial unique
--      makes the second INSERT fail with a Postgres unique violation, which
--      OvertimeService.submit() surfaces as 409 `DUPLICATE_WORK_DATE`.
--
--      Rejected/cancelled rows are EXCLUDED from the constraint so users can
--      re-submit after a rejection. Prisma does not model partial unique
--      indexes; this stays as raw SQL and is intentionally NOT expressed in
--      schema.prisma to prevent `prisma migrate dev` from dropping it in a
--      future automated migration.
--
-- Both statements are idempotent-safe under `prisma migrate deploy` since
-- migrations run exactly once by their timestamp.
-- =============================================================================

-- CreateIndex
CREATE INDEX "OvertimeRequest_status_workDate_idx"
  ON "OvertimeRequest" ("status", "workDate");

-- CreateIndex (partial unique — raw SQL, not tracked by Prisma)
CREATE UNIQUE INDEX "OvertimeRequest_userId_workDate_active_uidx"
  ON "OvertimeRequest" ("userId", "workDate")
  WHERE "status" IN ('PENDING_APPROVAL', 'APPROVED', 'COMPLETED')
    AND "deletedAt" IS NULL;
