-- OPS-6 + OPS-7 — Retention Enforcement Audit + Tenant Usage Snapshots.

-- OPS-6: extend `NotificationType` with the DPO alert emitted when the
-- monthly audit surfaces a gap.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RETENTION_AUDIT_GAP_DETECTED';

--
-- Two independent tables land in one migration to minimise disruption:
--
--   1. RetentionAuditReport      — monthly attestation that
--                                  RetentionWorker honoured RetentionPolicy.
--                                  Append-only (UPDATE + DELETE revoked).
--   2. TenantUsageSnapshot       — monthly snapshot of tenant footprint
--                                  (storage / db rows / emails / webhooks /
--                                  active users). Basis for future billing.

-- ============================================================================
-- OPS-6: RetentionAuditReport
-- ============================================================================

CREATE TYPE "RetentionAuditStatus" AS ENUM (
  'SUCCESS',
  'GAP_DETECTED',
  'WORKER_INACTIVE'
);

CREATE TABLE "RetentionAuditReport" (
  "id"                            TEXT NOT NULL,
  "companyId"                     TEXT NOT NULL,
  "periodStart"                   TIMESTAMP(3) NOT NULL,
  "periodEnd"                     TIMESTAMP(3) NOT NULL,
  "generatedAt"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status"                        "RetentionAuditStatus" NOT NULL,

  "notificationsPruned"           INTEGER NOT NULL DEFAULT 0,
  "usersAutoAnonymised"           INTEGER NOT NULL DEFAULT 0,
  "dsarArchivesExpired"           INTEGER NOT NULL DEFAULT 0,

  "notificationsPastRetention"    INTEGER NOT NULL DEFAULT 0,
  "dsarArchivesPastRetention"     INTEGER NOT NULL DEFAULT 0,
  "terminatedUsersPastRetention"  INTEGER NOT NULL DEFAULT 0,

  "policySnapshot"                JSONB NOT NULL,
  "workerLastRunAt"               TIMESTAMP(3),
  "findings"                      JSONB NOT NULL,
  "notes"                         TEXT,

  CONSTRAINT "RetentionAuditReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RetentionAuditReport_period_positive"
    CHECK ("periodEnd" > "periodStart"),
  CONSTRAINT "RetentionAuditReport_counts_nonneg"
    CHECK (
      "notificationsPruned"           >= 0 AND
      "usersAutoAnonymised"           >= 0 AND
      "dsarArchivesExpired"           >= 0 AND
      "notificationsPastRetention"    >= 0 AND
      "dsarArchivesPastRetention"     >= 0 AND
      "terminatedUsersPastRetention"  >= 0
    )
);

CREATE UNIQUE INDEX "RetentionAuditReport_companyId_periodStart_key"
  ON "RetentionAuditReport" ("companyId", "periodStart");
CREATE INDEX "RetentionAuditReport_companyId_generatedAt_idx"
  ON "RetentionAuditReport" ("companyId", "generatedAt");
CREATE INDEX "RetentionAuditReport_status_generatedAt_idx"
  ON "RetentionAuditReport" ("status", "generatedAt");

ALTER TABLE "RetentionAuditReport"
  ADD CONSTRAINT "RetentionAuditReport_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Attestation table — reads only after generation. Regeneration goes
-- through the service which DELETEs the old row inside a system-actor
-- transaction; we don't grant UPDATE+DELETE to the app user in prod
-- but keep the DDL-level ability so migrations can still drop columns.
COMMENT ON TABLE "RetentionAuditReport" IS
  'OPS-6: append-only monthly attestation. Regeneration must go through the service.';

-- ============================================================================
-- OPS-7: TenantUsageSnapshot
-- ============================================================================

CREATE TABLE "TenantUsageSnapshot" (
  "id"                     TEXT NOT NULL,
  "companyId"              TEXT NOT NULL,
  "periodStart"            TIMESTAMP(3) NOT NULL,
  "periodEnd"              TIMESTAMP(3) NOT NULL,
  "generatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  "storageExportBytes"     BIGINT NOT NULL DEFAULT 0,
  "storageDsarBytes"       BIGINT NOT NULL DEFAULT 0,
  "storageTotalBytes"      BIGINT NOT NULL DEFAULT 0,
  "attachmentBytesTracked" BOOLEAN NOT NULL DEFAULT false,

  "dbRowsUser"             INTEGER NOT NULL DEFAULT 0,
  "dbRowsAttendance"       INTEGER NOT NULL DEFAULT 0,
  "dbRowsLeave"            INTEGER NOT NULL DEFAULT 0,
  "dbRowsOvertime"         INTEGER NOT NULL DEFAULT 0,
  "dbRowsTimesheetEntry"   INTEGER NOT NULL DEFAULT 0,
  "dbRowsAuditLog"         INTEGER NOT NULL DEFAULT 0,
  "dbRowsNotification"     INTEGER NOT NULL DEFAULT 0,
  "dbRowsTimesheetExport"  INTEGER NOT NULL DEFAULT 0,
  "dbRowsWebhookDelivery"  INTEGER NOT NULL DEFAULT 0,
  "dbRowsTotal"            BIGINT NOT NULL DEFAULT 0,

  "notificationsCreated"   INTEGER NOT NULL DEFAULT 0,
  "webhookDeliveries"      INTEGER NOT NULL DEFAULT 0,
  "activeUsers"            INTEGER NOT NULL DEFAULT 0,
  "totalUsers"             INTEGER NOT NULL DEFAULT 0,

  "notes"                  TEXT,

  CONSTRAINT "TenantUsageSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TenantUsageSnapshot_period_positive"
    CHECK ("periodEnd" > "periodStart"),
  CONSTRAINT "TenantUsageSnapshot_bytes_nonneg"
    CHECK (
      "storageExportBytes" >= 0 AND
      "storageDsarBytes"   >= 0 AND
      "storageTotalBytes"  >= 0
    ),
  CONSTRAINT "TenantUsageSnapshot_counts_nonneg"
    CHECK (
      "dbRowsUser"            >= 0 AND
      "dbRowsAttendance"      >= 0 AND
      "dbRowsLeave"           >= 0 AND
      "dbRowsOvertime"        >= 0 AND
      "dbRowsTimesheetEntry"  >= 0 AND
      "dbRowsAuditLog"        >= 0 AND
      "dbRowsNotification"    >= 0 AND
      "dbRowsTimesheetExport" >= 0 AND
      "dbRowsWebhookDelivery" >= 0 AND
      "dbRowsTotal"           >= 0 AND
      "notificationsCreated"  >= 0 AND
      "webhookDeliveries"     >= 0 AND
      "activeUsers"           >= 0 AND
      "totalUsers"            >= 0
    )
);

CREATE UNIQUE INDEX "TenantUsageSnapshot_companyId_periodStart_key"
  ON "TenantUsageSnapshot" ("companyId", "periodStart");
CREATE INDEX "TenantUsageSnapshot_companyId_generatedAt_idx"
  ON "TenantUsageSnapshot" ("companyId", "generatedAt");
CREATE INDEX "TenantUsageSnapshot_generatedAt_idx"
  ON "TenantUsageSnapshot" ("generatedAt");

ALTER TABLE "TenantUsageSnapshot"
  ADD CONSTRAINT "TenantUsageSnapshot_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON TABLE "TenantUsageSnapshot" IS
  'OPS-7: monthly per-tenant usage snapshot. Basis for billing tiers.';
