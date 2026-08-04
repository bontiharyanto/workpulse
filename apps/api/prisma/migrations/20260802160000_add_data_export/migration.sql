-- CreateEnum
CREATE TYPE "DataExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "DataExportRequest" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "status"        "DataExportStatus" NOT NULL DEFAULT 'PENDING',
  "requestedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt"     TIMESTAMP(3),
  "completedAt"   TIMESTAMP(3),
  "failedAt"      TIMESTAMP(3),
  "failureReason" TEXT,
  "fileKey"       TEXT,
  "fileSize"      INTEGER,
  "expiresAt"     TIMESTAMP(3),

  CONSTRAINT "DataExportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataExportRequest_userId_requestedAt_idx" ON "DataExportRequest" ("userId", "requestedAt");
CREATE INDEX "DataExportRequest_status_requestedAt_idx" ON "DataExportRequest" ("status", "requestedAt");
CREATE INDEX "DataExportRequest_companyId_status_idx" ON "DataExportRequest" ("companyId", "status");

-- AddForeignKey
ALTER TABLE "DataExportRequest"
  ADD CONSTRAINT "DataExportRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
