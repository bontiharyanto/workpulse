-- CreateEnum
CREATE TYPE "LocationShareRequestStatus" AS ENUM ('PENDING', 'RESPONDED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'LOCATION_SHARE_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'LOCATION_SHARE_RESPONDED';
ALTER TYPE "NotificationType" ADD VALUE 'LOCATION_SHARE_VIEWED';
ALTER TYPE "NotificationType" ADD VALUE 'LOCATION_SHARING_CONSENT_CHANGED';

-- AlterTable
ALTER TABLE "SecurityPolicy" ADD COLUMN     "locationSharingConsentCopySha" TEXT,
ADD COLUMN     "locationSharingDpiaId" TEXT,
ADD COLUMN     "locationSharingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "locationSharingEnabledAt" TIMESTAMP(3),
ADD COLUMN     "locationSharingEnabledById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isFieldWorker" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "locationSharingConsentCopySha" TEXT,
ADD COLUMN     "locationSharingConsentedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LocationShareRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supervisorId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "status" "LocationShareRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "locationPingId" TEXT,

    CONSTRAINT "LocationShareRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationPing" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "accuracyMeters" INTEGER NOT NULL,
    "clientCapturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationPing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LocationShareRequest_locationPingId_key" ON "LocationShareRequest"("locationPingId");

-- CreateIndex
CREATE INDEX "LocationShareRequest_targetUserId_status_createdAt_idx" ON "LocationShareRequest"("targetUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "LocationShareRequest_supervisorId_status_createdAt_idx" ON "LocationShareRequest"("supervisorId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "LocationShareRequest_companyId_createdAt_idx" ON "LocationShareRequest"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "LocationShareRequest_supervisorId_targetUserId_status_idx" ON "LocationShareRequest"("supervisorId", "targetUserId", "status");

-- CreateIndex
CREATE INDEX "LocationPing_companyId_createdAt_idx" ON "LocationPing"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "LocationPing_userId_createdAt_idx" ON "LocationPing"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "SecurityPolicy" ADD CONSTRAINT "SecurityPolicy_locationSharingEnabledById_fkey" FOREIGN KEY ("locationSharingEnabledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityPolicy" ADD CONSTRAINT "SecurityPolicy_locationSharingDpiaId_fkey" FOREIGN KEY ("locationSharingDpiaId") REFERENCES "DpiaAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationShareRequest" ADD CONSTRAINT "LocationShareRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationShareRequest" ADD CONSTRAINT "LocationShareRequest_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationShareRequest" ADD CONSTRAINT "LocationShareRequest_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationShareRequest" ADD CONSTRAINT "LocationShareRequest_locationPingId_fkey" FOREIGN KEY ("locationPingId") REFERENCES "LocationPing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPing" ADD CONSTRAINT "LocationPing_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPing" ADD CONSTRAINT "LocationPing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique — ADR-0041 invariant: "one live PENDING request per
-- (supervisor, target) pair". Terminal states (RESPONDED, DECLINED,
-- EXPIRED, CANCELLED) do NOT collide. Prisma's `@@unique` cannot
-- express partial predicates, so it lives as raw SQL here. The
-- service also checks server-side (P2002 → clean 409 CONFLICT) so
-- concurrent requests race to the DB and the loser gets a proper
-- error.
CREATE UNIQUE INDEX "LocationShareRequest_one_pending_per_pair"
  ON "LocationShareRequest" ("supervisorId", "targetUserId")
  WHERE "status" = 'PENDING';
