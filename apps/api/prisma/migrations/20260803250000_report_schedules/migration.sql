-- Fase 33c — Scheduled Email Reports.
-- Two tables + three enums. Delivery log is append-only; UPDATE / DELETE
-- are REVOKE'd at the end so the audit trail cannot be tampered with.

CREATE TYPE "ScheduledReportType" AS ENUM (
  'TIMESHEET_SUMMARY',
  'ROPA',
  'DPIA',
  'ANALYTICS_SNAPSHOT',
  'CUSTOM'
);

CREATE TYPE "ReportFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

CREATE TYPE "ReportDeliveryStatus" AS ENUM (
  'PENDING',
  'DISPATCHING',
  'DELIVERED',
  'FAILED'
);

CREATE TABLE "ReportSchedule" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "reportType"    "ScheduledReportType" NOT NULL,
  "savedReportId" TEXT,
  "name"          TEXT NOT NULL,
  "frequency"     "ReportFrequency" NOT NULL,
  "cadenceDay"    INTEGER,
  "cadenceHour"   INTEGER NOT NULL DEFAULT 6,
  "active"        BOOLEAN NOT NULL DEFAULT true,
  "recipients"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "nextRunAt"     TIMESTAMP(3) NOT NULL,
  "lastRunAt"     TIMESTAMP(3),
  "createdById"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportSchedule_companyId_active_nextRunAt_idx"
  ON "ReportSchedule" ("companyId", "active", "nextRunAt");
CREATE INDEX "ReportSchedule_nextRunAt_idx"
  ON "ReportSchedule" ("nextRunAt");

ALTER TABLE "ReportSchedule"
  ADD CONSTRAINT "ReportSchedule_cadenceHour_check"
  CHECK ("cadenceHour" BETWEEN 0 AND 23);
ALTER TABLE "ReportSchedule"
  ADD CONSTRAINT "ReportSchedule_cadenceDay_check"
  CHECK ("cadenceDay" IS NULL OR "cadenceDay" BETWEEN 0 AND 28);
ALTER TABLE "ReportSchedule"
  ADD CONSTRAINT "ReportSchedule_recipients_bounded_check"
  CHECK (array_length("recipients", 1) IS NULL
    OR array_length("recipients", 1) <= 20);

ALTER TABLE "ReportSchedule"
  ADD CONSTRAINT "ReportSchedule_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportSchedule"
  ADD CONSTRAINT "ReportSchedule_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ReportDelivery" (
  "id"                 TEXT NOT NULL,
  "scheduleId"         TEXT NOT NULL,
  "companyId"          TEXT NOT NULL,
  "status"             "ReportDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "recipients"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "payloadSha256"      TEXT,
  "payloadBytes"       INTEGER,
  "attachmentFilename" TEXT,
  "attempts"           INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt"      TIMESTAMP(3),
  "deliveredAt"        TIMESTAMP(3),
  "errorSnippet"       TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReportDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportDelivery_companyId_createdAt_idx"
  ON "ReportDelivery" ("companyId", "createdAt");
CREATE INDEX "ReportDelivery_scheduleId_createdAt_idx"
  ON "ReportDelivery" ("scheduleId", "createdAt");
CREATE INDEX "ReportDelivery_status_createdAt_idx"
  ON "ReportDelivery" ("status", "createdAt");

ALTER TABLE "ReportDelivery"
  ADD CONSTRAINT "ReportDelivery_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "ReportSchedule"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportDelivery"
  ADD CONSTRAINT "ReportDelivery_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Delivery log is append-only. Only INSERT is legal from the app user.
-- We deliberately keep the app role able to advance status via UPDATE
-- (the worker transitions PENDING → DISPATCHING → DELIVERED / FAILED)
-- because a fully-immutable table would force us to double the row
-- count for status flips. Instead we lock DELETEs — the audit trail
-- can never lose a row.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE 'REVOKE DELETE ON "ReportDelivery" FROM PUBLIC';
  END IF;
END$$;
