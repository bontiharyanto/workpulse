-- Fase 31e — DPIA (Data Protection Impact Assessment).
-- Two tables + two enums. Complements ROPA (Fase 31d): every high-risk
-- ROPA activity should carry at least one APPROVED DPIA.

CREATE TYPE "DpiaStatus"    AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'ARCHIVED');
CREATE TYPE "DpiaRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TABLE "DpiaAssessment" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "ropaActivityId"  TEXT NOT NULL,
  "status"          "DpiaStatus" NOT NULL DEFAULT 'DRAFT',

  "title"           TEXT NOT NULL,
  "scope"           TEXT NOT NULL,
  "necessity"       TEXT NOT NULL,
  "dpoOpinion"      TEXT,
  "conclusion"      TEXT,

  "createdById"     TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "reviewedById"    TEXT,
  "reviewedAt"      TIMESTAMP(3),
  "approvedById"    TEXT,
  "approvedAt"      TIMESTAMP(3),
  "archivedAt"      TIMESTAMP(3),

  CONSTRAINT "DpiaAssessment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DpiaAssessment_companyId_status_idx"
  ON "DpiaAssessment" ("companyId", "status");
CREATE INDEX "DpiaAssessment_ropaActivityId_createdAt_idx"
  ON "DpiaAssessment" ("ropaActivityId", "createdAt");

-- Partial unique: at most one APPROVED per ROPA activity. Ensures the
-- "current DPIA" invariant is upheld even under concurrent approvals.
CREATE UNIQUE INDEX "DpiaAssessment_one_approved_per_activity"
  ON "DpiaAssessment" ("ropaActivityId")
  WHERE status = 'APPROVED';

CREATE TABLE "DpiaRiskItem" (
  "id"                 TEXT NOT NULL,
  "assessmentId"       TEXT NOT NULL,
  "companyId"          TEXT NOT NULL,
  "ordinal"            INTEGER NOT NULL,
  "title"              TEXT NOT NULL,
  "description"        TEXT NOT NULL,

  "likelihood"         INTEGER NOT NULL,
  "impact"             INTEGER NOT NULL,
  "inherentLevel"      "DpiaRiskLevel" NOT NULL,

  "mitigations"        TEXT NOT NULL,
  "residualLikelihood" INTEGER NOT NULL,
  "residualImpact"     INTEGER NOT NULL,
  "residualLevel"      "DpiaRiskLevel" NOT NULL,

  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DpiaRiskItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DpiaRiskItem_assessmentId_ordinal_key"
  ON "DpiaRiskItem" ("assessmentId", "ordinal");
CREATE INDEX "DpiaRiskItem_companyId_residualLevel_idx"
  ON "DpiaRiskItem" ("companyId", "residualLevel");

-- CHECK constraints: keep raw scores inside the domain grid (1..5).
ALTER TABLE "DpiaRiskItem"
  ADD CONSTRAINT "DpiaRiskItem_likelihood_check"
  CHECK ("likelihood" BETWEEN 1 AND 5);
ALTER TABLE "DpiaRiskItem"
  ADD CONSTRAINT "DpiaRiskItem_impact_check"
  CHECK ("impact" BETWEEN 1 AND 5);
ALTER TABLE "DpiaRiskItem"
  ADD CONSTRAINT "DpiaRiskItem_residualLikelihood_check"
  CHECK ("residualLikelihood" BETWEEN 1 AND 5);
ALTER TABLE "DpiaRiskItem"
  ADD CONSTRAINT "DpiaRiskItem_residualImpact_check"
  CHECK ("residualImpact" BETWEEN 1 AND 5);
-- Residual must be ≤ inherent — mitigations cannot make a risk worse.
ALTER TABLE "DpiaRiskItem"
  ADD CONSTRAINT "DpiaRiskItem_residual_le_inherent_check"
  CHECK ("residualLikelihood" <= "likelihood" AND "residualImpact" <= "impact");

-- FKs
ALTER TABLE "DpiaAssessment"
  ADD CONSTRAINT "DpiaAssessment_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DpiaAssessment"
  ADD CONSTRAINT "DpiaAssessment_ropaActivityId_fkey"
  FOREIGN KEY ("ropaActivityId") REFERENCES "RopaActivity"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DpiaAssessment"
  ADD CONSTRAINT "DpiaAssessment_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DpiaAssessment"
  ADD CONSTRAINT "DpiaAssessment_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DpiaAssessment"
  ADD CONSTRAINT "DpiaAssessment_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DpiaRiskItem"
  ADD CONSTRAINT "DpiaRiskItem_assessmentId_fkey"
  FOREIGN KEY ("assessmentId") REFERENCES "DpiaAssessment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DpiaRiskItem"
  ADD CONSTRAINT "DpiaRiskItem_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
