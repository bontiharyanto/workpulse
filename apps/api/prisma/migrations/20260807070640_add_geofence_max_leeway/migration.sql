-- AlterTable
-- Add `maxLeewayMeters` to Geofence. Default 50 m matches typical indoor GPS
-- drift in Jakarta CBD towers; set to 0 to restore the strict pre-2026-08-07
-- circle-membership check. NOT NULL because "no leeway" is expressible as 0
-- and we want a stable server-side invariant (never null coalescing at the
-- hot clock-in path).
ALTER TABLE "Geofence" ADD COLUMN "maxLeewayMeters" INTEGER NOT NULL DEFAULT 50;
