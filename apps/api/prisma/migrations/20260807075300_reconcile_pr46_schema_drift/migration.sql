-- Reconciles schema drift accumulated across #46. Each hunk below is a
-- schema change that landed in `apps/api/prisma/schema.prisma` on `main`
-- without a paired migration file. Running `prisma migrate dev` any time
-- before this migration produces exactly this SQL, so treat it as the
-- proper "backfill" of what should have been shipped earlier.
--
-- Everything here is a safe, additive/idempotent adjustment:
--   * DROP INDEX and DROP DEFAULT undo constraints that were removed
--     from the schema — the DB was carrying an obsolete artefact.
--   * ALTER COLUMN SET DEFAULT reintroduces a per-column default that
--     the schema declared but never migrated.
--   * RenameIndex is a pure catalogue rename (no data touched).
--
-- Extracted from the auto-generated diff of the location-sharing feature
-- migration to keep the substantive change auditable in isolation.

-- DropIndex — Timesheet composite `(companyId, status)` is no longer
-- referenced by the schema (superseded by more specific indexes added
-- during the timesheet Fase 32 series).
DROP INDEX IF EXISTS "Timesheet_companyId_status_idx";

-- RefreshToken: `mfaVerified` gained an explicit `@default(false)`
-- when the MFA step-up flow shipped in ADR-0017. Existing rows are
-- already NOT NULL because the migration that added the column set a
-- runtime default; this statement records the schema-side intent so
-- fresh replicas do the right thing.
ALTER TABLE "RefreshToken" ALTER COLUMN "mfaVerified" SET DEFAULT false;

-- ReportDelivery / ReportSchedule: the `recipients` JSON default was
-- removed from the schema (services always pass an explicit array).
-- No data change — Postgres accepts NULL rows, but the schema no
-- longer promises a default value.
ALTER TABLE "ReportDelivery" ALTER COLUMN "recipients" DROP DEFAULT;
ALTER TABLE "ReportSchedule" ALTER COLUMN "recipients" DROP DEFAULT;

-- RopaActivityVersion: three array columns lost their `@default([])`
-- when the RoPA import flow was reworked to demand explicit values.
ALTER TABLE "RopaActivityVersion" ALTER COLUMN "dataCategories" DROP DEFAULT,
  ALTER COLUMN "subjectCategories" DROP DEFAULT,
  ALTER COLUMN "recipients" DROP DEFAULT;

-- VendorProcessor: same story for `dataCategories` and
-- `securityCertifications`.
ALTER TABLE "VendorProcessor" ALTER COLUMN "dataCategories" DROP DEFAULT,
  ALTER COLUMN "securityCertifications" DROP DEFAULT;

-- RenameIndex: the schema stopped using explicit `name:` overrides on
-- these two `@@unique` declarations, so Prisma normalises them back to
-- its default naming convention.
ALTER INDEX "RopaActivityVendor_activity_vendor_key"
  RENAME TO "RopaActivityVendor_ropaActivityId_vendorId_key";
ALTER INDEX "VendorReminderLog_dedup_key"
  RENAME TO "VendorReminderLog_vendorId_kind_expectedFor_key";
