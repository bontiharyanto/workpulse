-- Fase 31f — Vendor / Processor Register.
--
-- Registry of every third-party data processor per UU 27/2022
-- Pelindungan Data Pribadi Pasal 45 + GDPR Art. 28. Sister to
-- `RopaActivity` (Fase 31d): ROPA answers "what data", this
-- registry answers "who else touches it and under what agreement".

-- Extend NotificationType with the two new DPO alerts.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VENDOR_REVIEW_DUE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VENDOR_CONTRACT_EXPIRING';

-- Enums --------------------------------------------------------------

CREATE TYPE "VendorCategory" AS ENUM (
  'PAYROLL',
  'STORAGE',
  'EMAIL',
  'MONITORING',
  'PAYMENT',
  'HR_SUITE',
  'COMMUNICATION',
  'OTHER'
);

CREATE TYPE "VendorStatus" AS ENUM (
  'UNDER_REVIEW',
  'ACTIVE',
  'DEPRECATED',
  'TERMINATED'
);

CREATE TYPE "VendorDataVolume" AS ENUM (
  'LOW',
  'MEDIUM',
  'HIGH',
  'MASSIVE'
);

CREATE TYPE "VendorReminderKind" AS ENUM (
  'REVIEW_DUE',
  'CONTRACT_EXPIRING'
);

-- VendorProcessor ----------------------------------------------------

CREATE TABLE "VendorProcessor" (
  "id"                     TEXT NOT NULL,
  "companyId"              TEXT NOT NULL,
  "slug"                   TEXT NOT NULL,
  "name"                   TEXT NOT NULL,
  "category"               "VendorCategory" NOT NULL,
  "status"                 "VendorStatus" NOT NULL DEFAULT 'UNDER_REVIEW',
  "description"            TEXT NOT NULL,

  "dataCategories"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "personalDataVolume"     "VendorDataVolume" NOT NULL DEFAULT 'LOW',
  "dataResidency"          TEXT,

  "contactName"            TEXT,
  "contactEmail"           TEXT,
  "contactPhone"           TEXT,
  "contractDocumentUrl"    TEXT,
  "contractStartAt"        TIMESTAMP(3),
  "contractEndAt"          TIMESTAMP(3),
  "dpaSignedAt"            TIMESTAMP(3),
  "subprocessorsAllowed"   BOOLEAN NOT NULL DEFAULT false,
  "securityCertifications" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  "nextReviewAt"           TIMESTAMP(3) NOT NULL,
  "lastReviewedAt"         TIMESTAMP(3),
  "lastReviewNote"         TEXT,

  "terminatedAt"           TIMESTAMP(3),
  "terminatedReason"       TEXT,
  "terminatedById"         TEXT,

  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL,
  "createdById"            TEXT,
  "updatedById"            TEXT,
  "deletedAt"              TIMESTAMP(3),

  CONSTRAINT "VendorProcessor_pkey" PRIMARY KEY ("id"),
  -- Contract window must be forward-going if both ends provided.
  CONSTRAINT "VendorProcessor_contract_window"
    CHECK ("contractStartAt" IS NULL
        OR "contractEndAt" IS NULL
        OR "contractEndAt" > "contractStartAt"),
  -- Terminated vendors must carry a terminatedAt timestamp.
  CONSTRAINT "VendorProcessor_terminated_consistent"
    CHECK ("status" <> 'TERMINATED' OR "terminatedAt" IS NOT NULL)
);

CREATE UNIQUE INDEX "VendorProcessor_companyId_slug_key"
  ON "VendorProcessor" ("companyId", "slug");
CREATE INDEX "VendorProcessor_companyId_status_idx"
  ON "VendorProcessor" ("companyId", "status");
CREATE INDEX "VendorProcessor_companyId_nextReviewAt_idx"
  ON "VendorProcessor" ("companyId", "nextReviewAt");
CREATE INDEX "VendorProcessor_companyId_contractEndAt_idx"
  ON "VendorProcessor" ("companyId", "contractEndAt");

ALTER TABLE "VendorProcessor"
  ADD CONSTRAINT "VendorProcessor_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VendorProcessor"
  ADD CONSTRAINT "VendorProcessor_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VendorProcessor"
  ADD CONSTRAINT "VendorProcessor_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VendorProcessor"
  ADD CONSTRAINT "VendorProcessor_terminatedById_fkey"
  FOREIGN KEY ("terminatedById") REFERENCES "User" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMENT ON TABLE "VendorProcessor" IS
  'Fase 31f: per-tenant register of third-party data processors (UU PDP Pasal 45 + GDPR Art. 28).';

-- RopaActivityVendor join --------------------------------------------

CREATE TABLE "RopaActivityVendor" (
  "id"             TEXT NOT NULL,
  "ropaActivityId" TEXT NOT NULL,
  "vendorId"       TEXT NOT NULL,
  "companyId"      TEXT NOT NULL,
  "note"           TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById"    TEXT,

  CONSTRAINT "RopaActivityVendor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RopaActivityVendor_activity_vendor_key"
  ON "RopaActivityVendor" ("ropaActivityId", "vendorId");
CREATE INDEX "RopaActivityVendor_vendorId_idx"
  ON "RopaActivityVendor" ("vendorId");
CREATE INDEX "RopaActivityVendor_companyId_idx"
  ON "RopaActivityVendor" ("companyId");

ALTER TABLE "RopaActivityVendor"
  ADD CONSTRAINT "RopaActivityVendor_ropaActivityId_fkey"
  FOREIGN KEY ("ropaActivityId") REFERENCES "RopaActivity" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RopaActivityVendor"
  ADD CONSTRAINT "RopaActivityVendor_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "VendorProcessor" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- VendorReminderLog append-only -------------------------------------

CREATE TABLE "VendorReminderLog" (
  "id"          TEXT NOT NULL,
  "vendorId"    TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "kind"        "VendorReminderKind" NOT NULL,
  "expectedFor" TIMESTAMP(3) NOT NULL,
  "firedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VendorReminderLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VendorReminderLog_dedup_key"
  ON "VendorReminderLog" ("vendorId", "kind", "expectedFor");
CREATE INDEX "VendorReminderLog_companyId_firedAt_idx"
  ON "VendorReminderLog" ("companyId", "firedAt");

ALTER TABLE "VendorReminderLog"
  ADD CONSTRAINT "VendorReminderLog_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "VendorProcessor" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Log is append-only. Deletes are only allowed via CASCADE from the
-- parent vendor (i.e. an admin cleanup of a "created by mistake" row).
COMMENT ON TABLE "VendorReminderLog" IS
  'Fase 31f: append-only dedup ledger for VendorReviewReminderWorker.';
