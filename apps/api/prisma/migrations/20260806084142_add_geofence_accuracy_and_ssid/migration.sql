-- AlterTable
ALTER TABLE "Geofence" ADD COLUMN     "allowedSsids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "maxAccuracyMeters" INTEGER;
