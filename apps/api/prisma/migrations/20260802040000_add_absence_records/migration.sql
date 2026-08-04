-- =============================================================================
-- Migration: add_absence_records
-- -----------------------------------------------------------------------------
-- Introduces the auto-absent classification feature (see docs/WORKFLOW §1.6):
--   * `AbsenceRecord` table + `AbsenceSource` enum.
--   * `Company.absentScanGraceHours` (default 6h) and
--     `Company.lastAbsentScanDate` cursor for the hourly cron.
--
-- Rollout considerations:
--   * `lastAbsentScanDate` is nullable so the very first scan targets ALL
--     working days back to some sensible bound (the scanner caps this at
--     30 days). Existing tenants therefore get a one-shot backfill on the
--     first run — intentional, so historical absences appear in reports.
-- =============================================================================

-- CreateEnum
CREATE TYPE "AbsenceSource" AS ENUM ('AUTO_SCHEDULER', 'MANUAL_HR');

-- AlterEnum: add the notification type emitted by the scanner
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ATTENDANCE_ABSENT_MARKED';

-- AlterTable Company: policy + scan cursor
ALTER TABLE "Company"
  ADD COLUMN "absentScanGraceHours" INTEGER NOT NULL DEFAULT 6,
  ADD COLUMN "lastAbsentScanDate"   DATE;

-- CreateTable AbsenceRecord
CREATE TABLE "AbsenceRecord" (
  "id"         TEXT           NOT NULL,
  "companyId"  TEXT           NOT NULL,
  "userId"     TEXT           NOT NULL,
  "workDate"   DATE           NOT NULL,
  "source"     "AbsenceSource" NOT NULL,
  "reason"     TEXT,
  "markedById" TEXT,
  "createdAt"  TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AbsenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AbsenceRecord_userId_workDate_key"
  ON "AbsenceRecord" ("userId", "workDate");
CREATE INDEX "AbsenceRecord_companyId_workDate_idx"
  ON "AbsenceRecord" ("companyId", "workDate");
CREATE INDEX "AbsenceRecord_companyId_createdAt_idx"
  ON "AbsenceRecord" ("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "AbsenceRecord"
  ADD CONSTRAINT "AbsenceRecord_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbsenceRecord"
  ADD CONSTRAINT "AbsenceRecord_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AbsenceRecord"
  ADD CONSTRAINT "AbsenceRecord_markedById_fkey"
  FOREIGN KEY ("markedById") REFERENCES "User" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
