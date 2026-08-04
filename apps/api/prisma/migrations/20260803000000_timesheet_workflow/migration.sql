-- CreateEnum: TimesheetStatus
CREATE TYPE "TimesheetStatus" AS ENUM (
  'DRAFT',
  'PENDING_SUPERVISOR',
  'PENDING_HR',
  'APPROVED',
  'REJECTED'
);

-- ExtendEnum: NotificationType — new events for the Fase 32b workflow.
ALTER TYPE "NotificationType" ADD VALUE 'TIMESHEET_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'TIMESHEET_APPROVED_SUPERVISOR';
ALTER TYPE "NotificationType" ADD VALUE 'TIMESHEET_APPROVED_HR';
ALTER TYPE "NotificationType" ADD VALUE 'TIMESHEET_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'TIMESHEET_REGENERATED';

-- AlterTable: Shift.breakMinutes
ALTER TABLE "Shift"
  ADD COLUMN "breakMinutes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: Timesheet workflow fields
ALTER TABLE "Timesheet"
  ADD COLUMN "status"          "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "submittedAt"     TIMESTAMP(3),
  ADD COLUMN "supervisorId"    TEXT,
  ADD COLUMN "supervisorAt"    TIMESTAMP(3),
  ADD COLUMN "supervisorNote"  TEXT,
  ADD COLUMN "hrManagerId"     TEXT,
  ADD COLUMN "hrManagerAt"     TIMESTAMP(3),
  ADD COLUMN "hrManagerNote"   TEXT,
  ADD COLUMN "rejectedById"    TEXT,
  ADD COLUMN "rejectedAt"      TIMESTAMP(3),
  ADD COLUMN "rejectionReason" TEXT;

ALTER TABLE "Timesheet"
  ADD CONSTRAINT "Timesheet_supervisorId_fkey"
  FOREIGN KEY ("supervisorId") REFERENCES "User" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Timesheet"
  ADD CONSTRAINT "Timesheet_hrManagerId_fkey"
  FOREIGN KEY ("hrManagerId") REFERENCES "User" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Timesheet"
  ADD CONSTRAINT "Timesheet_rejectedById_fkey"
  FOREIGN KEY ("rejectedById") REFERENCES "User" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Index the queue view "pending timesheets for company":
--   filters by companyId + status, orders by submittedAt.
CREATE INDEX "Timesheet_companyId_status_idx"
  ON "Timesheet" ("companyId", "status");
