-- Fase 33b — Custom Report Builder.
-- SavedReport table stores a validated `definition` JSONB. FE + service
-- both re-validate before executing so the blob is safe to persist.

CREATE TABLE "SavedReport" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "definition"  JSONB NOT NULL,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SavedReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SavedReport_companyId_name_key"
  ON "SavedReport" ("companyId", "name");
CREATE INDEX "SavedReport_companyId_updatedAt_idx"
  ON "SavedReport" ("companyId", "updatedAt");

ALTER TABLE "SavedReport"
  ADD CONSTRAINT "SavedReport_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SavedReport"
  ADD CONSTRAINT "SavedReport_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
