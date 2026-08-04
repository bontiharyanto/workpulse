-- =============================================================================
-- Migration: add_payroll_lock_cutoff
-- -----------------------------------------------------------------------------
-- Introduces `Company.payrollLockedUntil` (see docs/WORKFLOW §1.8 and
-- docs/ADR/ADR-0010-payroll-cutoff.md).
--
-- Semantics:
--   * Inclusive freeze cutoff. Any attendance-affecting mutation targeting
--     `workDate <= payrollLockedUntil` is refused for non-SUPER_ADMIN roles.
--   * `NULL` = no cutoff. Existing tenants get NULL by default so behaviour
--     is unchanged until an admin explicitly opts in.
--   * `@db.Date` — payroll periods close on calendar days; comparing
--     `timestamp` here would be a subtle timezone bug.
-- =============================================================================

ALTER TABLE "Company"
  ADD COLUMN "payrollLockedUntil" DATE;
