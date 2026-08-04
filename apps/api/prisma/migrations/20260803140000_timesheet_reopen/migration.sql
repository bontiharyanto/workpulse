-- Fase 32g — Reopen APPROVED timesheet.
--
-- 1. New enum values (must run outside a tx block; Prisma migrate
--    wrapper handles that).
-- 2. Denorm columns on Timesheet for the hot-path queue view.
--    Full history stays in AuditLog (append-only) — these are just
--    fast-path reads for the "was this row reopened recently?" UI.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TIMESHEET_REOPENED';
ALTER TYPE "WebhookEventType" ADD VALUE IF NOT EXISTS 'TIMESHEET_REOPENED';

ALTER TABLE "Timesheet"
  ADD COLUMN "reopenCount"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastReopenedAt"    TIMESTAMP(3),
  ADD COLUMN "lastReopenedById"  TEXT,
  ADD COLUMN "lastReopenReason"  TEXT;

ALTER TABLE "Timesheet"
  ADD CONSTRAINT "Timesheet_lastReopenedById_fkey"
  FOREIGN KEY ("lastReopenedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Guard so an operator can't accidentally set a bogus negative count
-- (Prisma's @default(0) doesn't stop a raw UPDATE from doing damage).
ALTER TABLE "Timesheet"
  ADD CONSTRAINT "Timesheet_reopenCount_check" CHECK ("reopenCount" >= 0);

-- Index for the "how often does this user get reopened?" analytics
-- query. Cheap because it's partial — we only care about rows that
-- have been reopened at least once.
CREATE INDEX "Timesheet_companyId_reopenCount_idx"
  ON "Timesheet" ("companyId", "reopenCount")
  WHERE "reopenCount" > 0;
