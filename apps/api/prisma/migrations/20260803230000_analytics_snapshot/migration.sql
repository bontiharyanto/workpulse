-- Fase 33a — Executive KPI Dashboard: AnalyticsSnapshot materialised table.
--
-- One row per (companyId, date, metricKey) — the physical backing store
-- for every executive dashboard read. The nightly worker upserts on the
-- unique key so re-runs / backfills are idempotent.

CREATE TYPE "AnalyticsMetricKey" AS ENUM (
  'ATTENDANCE_ON_TIME_RATE',
  'ATTENDANCE_LATE_COUNT',
  'ATTENDANCE_ABSENT_COUNT',
  'LEAVE_PENDING_COUNT',
  'LEAVE_DAYS_APPROVED',
  'OVERTIME_HOURS',
  'OVERTIME_COST_IDR',
  'HEADCOUNT_ACTIVE',
  'HEADCOUNT_TERMINATED'
);

CREATE TABLE "AnalyticsSnapshot" (
  "id"         TEXT NOT NULL,
  "companyId"  TEXT NOT NULL,
  -- Tenant-local calendar day; the compute service resolves "yesterday
  -- in Company.timezone" before writing. `DATE` (no time) is intentional
  -- so timezone drift on the row itself is impossible.
  "date"       DATE NOT NULL,
  "metricKey"  "AnalyticsMetricKey" NOT NULL,
  -- Wide enough for cost metrics in IDR while keeping 4 dp for ratios.
  "value"      DECIMAL(18, 4) NOT NULL,
  -- Optional slice payload. NULL for the current company-wide roll-ups.
  "dimension"  JSONB,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- Idempotency backbone: nightly upsert target.
CREATE UNIQUE INDEX "AnalyticsSnapshot_companyId_date_metricKey_key"
  ON "AnalyticsSnapshot" ("companyId", "date", "metricKey");

-- Read path index — dashboard queries scan by (tenant, metric) then
-- bounded date range.
CREATE INDEX "AnalyticsSnapshot_companyId_metricKey_date_idx"
  ON "AnalyticsSnapshot" ("companyId", "metricKey", "date");

ALTER TABLE "AnalyticsSnapshot"
  ADD CONSTRAINT "AnalyticsSnapshot_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
