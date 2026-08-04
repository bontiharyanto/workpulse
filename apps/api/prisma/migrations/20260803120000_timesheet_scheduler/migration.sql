-- Fase 32f — Auto-generation + reminder scheduler.
--
-- 1. Extend TimesheetConfig with per-tenant scheduler knobs. Defaults
--    match the "sensible cadence" documented in ADR-0028: reminders
--    start 1-2 days after period close and stop within a fortnight
--    so the notification queue never becomes noise.
-- 2. New TimesheetReminderLog table = audit trail + at-most-one-per-day
--    de-dupe key for the reminder worker. The unique index is what
--    makes multi-replica delivery safe.
-- 3. Extend NotificationType enum with the two new reminder kinds.

ALTER TABLE "TimesheetConfig"
  ADD COLUMN "autoGenerateEnabled"       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "reminderEnabled"           BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "submitReminderStartDays"   INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "submitReminderMaxDays"     INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "approvalReminderStartDays" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "approvalReminderMaxDays"   INTEGER NOT NULL DEFAULT 14;

-- Guard rails: catch operator-typo config that would either fire on
-- day zero (approvalStart = 0 → useless spam) or forever
-- (submitMaxDays = 999 → same). Range is deliberately wide (0..60)
-- because tenants with 30-day cutoffs may want a 3-week wait.
ALTER TABLE "TimesheetConfig"
  ADD CONSTRAINT "TimesheetConfig_submitReminderStartDays_check"
    CHECK ("submitReminderStartDays" >= 0 AND "submitReminderStartDays" <= 30),
  ADD CONSTRAINT "TimesheetConfig_submitReminderMaxDays_check"
    CHECK ("submitReminderMaxDays" >= "submitReminderStartDays"
       AND "submitReminderMaxDays" <= 60),
  ADD CONSTRAINT "TimesheetConfig_approvalReminderStartDays_check"
    CHECK ("approvalReminderStartDays" >= 0 AND "approvalReminderStartDays" <= 30),
  ADD CONSTRAINT "TimesheetConfig_approvalReminderMaxDays_check"
    CHECK ("approvalReminderMaxDays" >= "approvalReminderStartDays"
       AND "approvalReminderMaxDays" <= 60);

-- Add new NotificationType enum values. Postgres ALTER TYPE ADD VALUE
-- cannot run inside a transaction; Prisma's migrate wrapper handles
-- that by executing each statement individually.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TIMESHEET_SUBMIT_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TIMESHEET_APPROVAL_REMINDER';

CREATE TABLE "TimesheetReminderLog" (
  "id"          TEXT NOT NULL,
  "timesheetId" TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "type"        "NotificationType" NOT NULL,
  "recipientId" TEXT NOT NULL,
  "sentDate"    DATE NOT NULL,
  "sentAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TimesheetReminderLog_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TimesheetReminderLog"
  ADD CONSTRAINT "TimesheetReminderLog_timesheetId_fkey"
  FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimesheetReminderLog"
  ADD CONSTRAINT "TimesheetReminderLog_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimesheetReminderLog"
  ADD CONSTRAINT "TimesheetReminderLog_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "TimesheetReminderLog_timesheetId_type_sentDate_key"
  ON "TimesheetReminderLog" ("timesheetId", "type", "sentDate");

CREATE INDEX "TimesheetReminderLog_companyId_sentDate_idx"
  ON "TimesheetReminderLog" ("companyId", "sentDate");

CREATE INDEX "TimesheetReminderLog_recipientId_sentDate_idx"
  ON "TimesheetReminderLog" ("recipientId", "sentDate");

-- Same posture as other audit tables — worker inserts, retention
-- worker deletes by age. No UPDATE is ever legitimate.
REVOKE UPDATE ON TABLE "TimesheetReminderLog" FROM PUBLIC;
