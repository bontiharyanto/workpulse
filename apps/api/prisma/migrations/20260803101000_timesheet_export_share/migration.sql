-- CreateTable
CREATE TABLE "TimesheetExportShare" (
  "id"               TEXT NOT NULL,
  "exportId"         TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "createdById"      TEXT NOT NULL,
  "expiresAt"        TIMESTAMP(3) NOT NULL,
  "revokedAt"        TIMESTAMP(3),
  "revokedById"      TEXT,
  "downloadCount"    INTEGER NOT NULL DEFAULT 0,
  "lastDownloadedAt" TIMESTAMP(3),
  "note"             TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TimesheetExportShare_pkey" PRIMARY KEY ("id")
);

-- FKs
ALTER TABLE "TimesheetExportShare"
  ADD CONSTRAINT "TimesheetExportShare_exportId_fkey"
  FOREIGN KEY ("exportId") REFERENCES "TimesheetExport"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimesheetExportShare"
  ADD CONSTRAINT "TimesheetExportShare_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimesheetExportShare"
  ADD CONSTRAINT "TimesheetExportShare_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TimesheetExportShare"
  ADD CONSTRAINT "TimesheetExportShare_revokedById_fkey"
  FOREIGN KEY ("revokedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "TimesheetExportShare_companyId_createdAt_idx"
  ON "TimesheetExportShare" ("companyId", "createdAt");

CREATE INDEX "TimesheetExportShare_exportId_revokedAt_idx"
  ON "TimesheetExportShare" ("exportId", "revokedAt");

-- Same immutability posture as TimesheetExport: only `revokedAt`,
-- `revokedById`, `downloadCount`, `lastDownloadedAt` should ever change.
-- We keep UPDATE on for the application role (the download handler
-- needs it), but forbid DELETE so the audit history stays intact.
REVOKE DELETE ON TABLE "TimesheetExportShare" FROM PUBLIC;
