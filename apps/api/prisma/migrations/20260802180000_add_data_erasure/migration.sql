-- CreateEnum
CREATE TYPE "DataErasureStatus" AS ENUM (
  'PENDING_APPROVAL',
  'APPROVED_SCHEDULED',
  'EXECUTED',
  'REJECTED',
  'CANCELLED',
  'FAILED'
);

-- CreateTable
CREATE TABLE "DataErasureRequest" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "status"        "DataErasureStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "reason"        TEXT,
  "requestedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedById"   TEXT,
  "decidedAt"     TIMESTAMP(3),
  "decisionNote"  TEXT,
  "scheduledFor"  TIMESTAMP(3),
  "executedAt"    TIMESTAMP(3),
  "cancelledAt"   TIMESTAMP(3),
  "failedAt"      TIMESTAMP(3),
  "failureReason" TEXT,

  CONSTRAINT "DataErasureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataErasureRequest_userId_requestedAt_idx"
  ON "DataErasureRequest" ("userId", "requestedAt");
CREATE INDEX "DataErasureRequest_companyId_status_idx"
  ON "DataErasureRequest" ("companyId", "status");
CREATE INDEX "DataErasureRequest_status_scheduledFor_idx"
  ON "DataErasureRequest" ("status", "scheduledFor");

-- AddForeignKey
ALTER TABLE "DataErasureRequest"
  ADD CONSTRAINT "DataErasureRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DataErasureRequest"
  ADD CONSTRAINT "DataErasureRequest_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
