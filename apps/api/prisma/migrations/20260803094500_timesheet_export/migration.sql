-- CreateEnum
CREATE TYPE "TimesheetExportFormat" AS ENUM ('CSV', 'XLSX');

-- CreateEnum
CREATE TYPE "TimesheetExportMode" AS ENUM ('SUMMARY', 'DETAIL');

-- CreateTable
CREATE TABLE "TimesheetExport" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "periodId"      TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "format"        "TimesheetExportFormat" NOT NULL,
  "mode"          "TimesheetExportMode" NOT NULL,
  "departmentId"  TEXT,
  "rowCount"      INTEGER NOT NULL,
  "entryCount"    INTEGER NOT NULL DEFAULT 0,
  "bytes"         INTEGER NOT NULL,
  "payloadSha256" TEXT NOT NULL,
  "note"          TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TimesheetExport_pkey" PRIMARY KEY ("id")
);

-- FKs
ALTER TABLE "TimesheetExport"
  ADD CONSTRAINT "TimesheetExport_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimesheetExport"
  ADD CONSTRAINT "TimesheetExport_periodId_fkey"
  FOREIGN KEY ("periodId") REFERENCES "TimesheetPeriod"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimesheetExport"
  ADD CONSTRAINT "TimesheetExport_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TimesheetExport"
  ADD CONSTRAINT "TimesheetExport_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "TimesheetExport_companyId_createdAt_idx"
  ON "TimesheetExport" ("companyId", "createdAt");

CREATE INDEX "TimesheetExport_periodId_idx"
  ON "TimesheetExport" ("periodId");

-- Immutability: append-only audit trail. Revoke UPDATE + DELETE at the
-- table level so accidentally-loose service code cannot silently rewrite
-- payroll history. The migration runner uses a superuser role so this
-- REVOKE is only enforced against application-role connections — that's
-- the intent.
REVOKE UPDATE, DELETE ON TABLE "TimesheetExport" FROM PUBLIC;
