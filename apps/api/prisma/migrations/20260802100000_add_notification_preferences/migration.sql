-- =============================================================================
-- Migration: add_notification_preferences
-- -----------------------------------------------------------------------------
-- Adds the per-user opt-out table for notification delivery. See ADR-0012.
--
-- Design highlights:
--
--   * Stores OVERRIDES only — no row means "both channels on". Prevents
--     the `|users| × |types|` cartesian explosion and gives new users a
--     sensible default (subscribed to everything).
--   * Unique `(userId, type)` = the fanout hot path is a single-row seek.
--   * Secondary index on `(companyId, type)` supports tenant-wide opt-out
--     analytics (admin only; not used by the delivery hot path).
--   * `onDelete: Cascade` on `userId` — preferences carry no meaning
--     without the owner.
--   * Mandatory types (`PASSWORD_RESET` today) are enforced in domain
--     logic, not by the DB. The DB accepts rows for mandatory types but
--     the effective-lookup ignores them; this keeps the schema stable
--     when the mandatory list changes.
-- =============================================================================

CREATE TABLE "NotificationPreference" (
  "id"           TEXT             NOT NULL,
  "companyId"    TEXT             NOT NULL,
  "userId"       TEXT             NOT NULL,
  "type"         "NotificationType" NOT NULL,
  "emailEnabled" BOOLEAN          NOT NULL DEFAULT true,
  "inAppEnabled" BOOLEAN          NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3)     NOT NULL,

  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationPreference_userId_type_key"
  ON "NotificationPreference" ("userId", "type");

CREATE INDEX "NotificationPreference_companyId_type_idx"
  ON "NotificationPreference" ("companyId", "type");

ALTER TABLE "NotificationPreference"
  ADD CONSTRAINT "NotificationPreference_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationPreference"
  ADD CONSTRAINT "NotificationPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
