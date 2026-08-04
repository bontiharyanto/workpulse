-- Fase 31d — ROPA Registry (Record of Processing Activities).
-- Two tables plus enums; append-only auditability comes from AuditLog +
-- the state machine (PUBLISHED versions cannot be UPDATE'd via service).

CREATE TYPE "RopaVersionStatus" AS ENUM ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "RopaLegalBasis"    AS ENUM ('CONTRACT', 'CONSENT', 'LEGAL_OBLIGATION', 'LEGITIMATE_INTEREST', 'VITAL_INTEREST', 'PUBLIC_TASK');

CREATE TABLE "RopaActivity" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "slug"             TEXT NOT NULL,
  "currentVersionId" TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RopaActivity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RopaActivity_currentVersionId_key"
  ON "RopaActivity" ("currentVersionId");

CREATE UNIQUE INDEX "RopaActivity_companyId_slug_key"
  ON "RopaActivity" ("companyId", "slug");

CREATE INDEX "RopaActivity_companyId_idx" ON "RopaActivity" ("companyId");

CREATE TABLE "RopaActivityVersion" (
  "id"                  TEXT NOT NULL,
  "activityId"          TEXT NOT NULL,
  "companyId"           TEXT NOT NULL,
  "version"             INTEGER NOT NULL,
  "status"              "RopaVersionStatus" NOT NULL DEFAULT 'DRAFT',

  "name"                TEXT NOT NULL,
  "purpose"             TEXT NOT NULL,
  "legalBasis"          "RopaLegalBasis" NOT NULL,
  "legalBasisDetail"    TEXT,
  "dataCategories"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "subjectCategories"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "recipients"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "retentionPeriod"     TEXT NOT NULL,
  "crossBorderTransfer" BOOLEAN NOT NULL DEFAULT false,
  "crossBorderDetail"   TEXT,
  "securityMeasures"    TEXT NOT NULL,
  "notes"               TEXT,

  "createdById"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedById"  TEXT,
  "reviewedAt"    TIMESTAMP(3),
  "publishedById" TEXT,
  "publishedAt"   TIMESTAMP(3),
  "archivedAt"    TIMESTAMP(3),

  CONSTRAINT "RopaActivityVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RopaActivityVersion_activityId_version_key"
  ON "RopaActivityVersion" ("activityId", "version");

CREATE INDEX "RopaActivityVersion_companyId_status_idx"
  ON "RopaActivityVersion" ("companyId", "status");

CREATE INDEX "RopaActivityVersion_companyId_publishedAt_idx"
  ON "RopaActivityVersion" ("companyId", "publishedAt");

-- Non-negative version guard — service always writes >= 1 but the DB
-- protects against a raw UPDATE bug.
ALTER TABLE "RopaActivityVersion"
  ADD CONSTRAINT "RopaActivityVersion_version_check" CHECK ("version" >= 1);

-- FKs
ALTER TABLE "RopaActivity"
  ADD CONSTRAINT "RopaActivity_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RopaActivity"
  ADD CONSTRAINT "RopaActivity_currentVersionId_fkey"
  FOREIGN KEY ("currentVersionId") REFERENCES "RopaActivityVersion"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RopaActivityVersion"
  ADD CONSTRAINT "RopaActivityVersion_activityId_fkey"
  FOREIGN KEY ("activityId") REFERENCES "RopaActivity"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RopaActivityVersion"
  ADD CONSTRAINT "RopaActivityVersion_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RopaActivityVersion"
  ADD CONSTRAINT "RopaActivityVersion_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RopaActivityVersion"
  ADD CONSTRAINT "RopaActivityVersion_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RopaActivityVersion"
  ADD CONSTRAINT "RopaActivityVersion_publishedById_fkey"
  FOREIGN KEY ("publishedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
