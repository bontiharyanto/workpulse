-- Persist the export payload alongside the audit row (Fase 32d) so
-- signed download URLs can serve the same bytes byte-identically
-- without a re-render + XLSX-determinism dance.
--
-- Nullable: pre-existing rows have no payload and cannot be shared;
-- the share endpoint returns 410 for those. Setting the column NOT
-- NULL later is a follow-up migration once every tenant has rotated
-- past the old rows.

ALTER TABLE "TimesheetExport"
  ADD COLUMN "payload" BYTEA;
