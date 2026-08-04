-- =============================================================================
-- Migration: add_notifications
-- -----------------------------------------------------------------------------
-- Adds the Notification model + NotificationType enum for the in-app
-- notification centre. See docs/WORKFLOW.md §9 for the event catalogue and
-- delivery semantics.
--
-- Design notes:
--   * `readAt IS NULL` is the "unread" predicate. The composite index
--     (recipientId, readAt, createdAt) makes the bell's unread-list query
--     run against a covering btree in the common case.
--   * FK to User uses CASCADE — when a user is hard-deleted, their
--     notifications go with them. Soft delete is unaffected (dead users
--     just stop polling).
-- =============================================================================

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM (
  'LEAVE_SUBMITTED',
  'LEAVE_APPROVED_SUPERVISOR',
  'LEAVE_APPROVED_HR',
  'LEAVE_REJECTED',
  'LEAVE_CANCELLED',
  'OVERTIME_SUBMITTED',
  'OVERTIME_APPROVED',
  'OVERTIME_REJECTED',
  'OVERTIME_CANCELLED',
  'OVERTIME_COMPLETED',
  'PASSWORD_RESET'
);

-- CreateTable
CREATE TABLE "Notification" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "type"        "NotificationType" NOT NULL,
  "title"       TEXT NOT NULL,
  "body"        TEXT NOT NULL,
  "data"        JSONB,
  "readAt"      TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_recipientId_readAt_createdAt_idx"
  ON "Notification" ("recipientId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_companyId_createdAt_idx"
  ON "Notification" ("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "User" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
