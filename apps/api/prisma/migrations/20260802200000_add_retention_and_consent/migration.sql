-- CreateTable: RetentionPolicy (per-tenant data-lifecycle config)
CREATE TABLE "RetentionPolicy" (
  "id"                              TEXT NOT NULL,
  "companyId"                       TEXT NOT NULL,
  "notificationRetentionDays"       INTEGER NOT NULL DEFAULT 90,
  "dataExportArchiveRetentionHours" INTEGER NOT NULL DEFAULT 24,
  "terminatedUserAnonymizeDays"     INTEGER NOT NULL DEFAULT 0,
  "updatedAt"                       TIMESTAMP(3) NOT NULL,
  "updatedById"                     TEXT,

  CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RetentionPolicy_companyId_key"
  ON "RetentionPolicy" ("companyId");

ALTER TABLE "RetentionPolicy"
  ADD CONSTRAINT "RetentionPolicy_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RetentionPolicy"
  ADD CONSTRAINT "RetentionPolicy_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: PrivacyPolicy (versioned tenant policies)
CREATE TABLE "PrivacyPolicy" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "version"       TEXT NOT NULL,
  "title"         TEXT NOT NULL,
  "body"          TEXT NOT NULL,
  "effectiveAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedById" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PrivacyPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrivacyPolicy_companyId_version_key"
  ON "PrivacyPolicy" ("companyId", "version");

CREATE INDEX "PrivacyPolicy_companyId_effectiveAt_idx"
  ON "PrivacyPolicy" ("companyId", "effectiveAt");

ALTER TABLE "PrivacyPolicy"
  ADD CONSTRAINT "PrivacyPolicy_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PrivacyPolicy"
  ADD CONSTRAINT "PrivacyPolicy_publishedById_fkey"
  FOREIGN KEY ("publishedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: UserConsent (append-only acceptance ledger)
CREATE TABLE "UserConsent" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "policyId"   TEXT NOT NULL,
  "companyId"  TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip"         TEXT,
  "userAgent"  TEXT,

  CONSTRAINT "UserConsent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserConsent_userId_policyId_key"
  ON "UserConsent" ("userId", "policyId");

CREATE INDEX "UserConsent_companyId_acceptedAt_idx"
  ON "UserConsent" ("companyId", "acceptedAt");

ALTER TABLE "UserConsent"
  ADD CONSTRAINT "UserConsent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserConsent"
  ADD CONSTRAINT "UserConsent_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "PrivacyPolicy" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
