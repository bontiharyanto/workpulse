-- =============================================================================
-- Migration: add_attendance_corrections
-- -----------------------------------------------------------------------------
-- Introduces the employee-initiated attendance correction workflow
-- (see docs/WORKFLOW §1.9 and ADR-0011):
--
--   * `AttendanceCorrection` table with single-level approval status.
--   * `AttendanceCorrectionStatus` enum.
--   * Three new `NotificationType` values (submitted / approved / rejected).
--
-- Design highlights:
--
--   * `requestedClockInAt` / `requestedClockOutAt` are BOTH nullable so a
--     correction can target just clock-in, just clock-out, or both. The
--     service layer enforces at least one is non-null (`AT_LEAST_ONE_TIME`
--     error).
--   * `supervisorId` is a snapshot at submission time so an approval queue
--     stays stable even if the reporting line changes mid-flight.
--   * `decidedById` points to the actor who APPROVED / REJECTED — separate
--     from supervisorId because HR / SUPER_ADMIN also decide via the same
--     endpoint.
--   * No partial unique on (userId, workDate): unlike overtime, an employee
--     may legitimately file MULTIPLE corrections against the same date
--     (e.g. corrected once, later realized the corrected time was wrong).
--     The apply step handles idempotency by never overwriting non-null
--     AttendanceRecord fields (§ ADR-0011).
-- =============================================================================

-- CreateEnum: request status
CREATE TYPE "AttendanceCorrectionStatus" AS ENUM (
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'CANCELLED'
);

-- AlterEnum: notification types emitted by the correction service
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ATTENDANCE_CORRECTION_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ATTENDANCE_CORRECTION_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ATTENDANCE_CORRECTION_REJECTED';

-- CreateTable: AttendanceCorrection
CREATE TABLE "AttendanceCorrection" (
  "id"                  TEXT           NOT NULL,
  "companyId"           TEXT           NOT NULL,
  "userId"              TEXT           NOT NULL,
  "workDate"            DATE           NOT NULL,
  "requestedClockInAt"  TIMESTAMP(3),
  "requestedClockOutAt" TIMESTAMP(3),
  "reason"              TEXT           NOT NULL,
  "attachmentUrl"       TEXT,
  "status"              "AttendanceCorrectionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',

  "supervisorId"        TEXT,
  "decidedById"         TEXT,
  "decidedAt"           TIMESTAMP(3),
  "decisionNote"        TEXT,

  "createdAt"           TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3)   NOT NULL,
  "deletedAt"           TIMESTAMP(3),

  CONSTRAINT "AttendanceCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceCorrection_companyId_status_idx"
  ON "AttendanceCorrection" ("companyId", "status");
CREATE INDEX "AttendanceCorrection_userId_createdAt_idx"
  ON "AttendanceCorrection" ("userId", "createdAt");
CREATE INDEX "AttendanceCorrection_userId_workDate_idx"
  ON "AttendanceCorrection" ("userId", "workDate");

-- AddForeignKey
ALTER TABLE "AttendanceCorrection"
  ADD CONSTRAINT "AttendanceCorrection_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AttendanceCorrection"
  ADD CONSTRAINT "AttendanceCorrection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttendanceCorrection"
  ADD CONSTRAINT "AttendanceCorrection_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "User" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
