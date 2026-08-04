/**
 * OPS-6 — Pure functions for retention audit gap detection.
 *
 * The audit report is derived from three inputs:
 *   1. `RetentionPolicy` snapshot at generation time.
 *   2. Aggregate counters from `AuditLog` scoped to the audit period.
 *   3. Gap counters from live tables (rows that should have been pruned).
 *
 * Everything in this file is a pure function — no Prisma, no dates
 * that leak from the caller's clock. This makes the whole thing
 * trivially testable and reproducible for any historical period.
 */

export type RetentionAuditStatus = 'SUCCESS' | 'GAP_DETECTED' | 'WORKER_INACTIVE';

export type RetentionAuditFindingKind =
  | 'notifications_past_retention'
  | 'dsar_archives_past_retention'
  | 'terminated_users_past_retention'
  | 'worker_inactive_during_period';

export interface RetentionAuditFinding {
  kind: RetentionAuditFindingKind;
  /** Machine-friendly, ready for Sentry tag / log field. */
  severity: 'info' | 'warning' | 'critical';
  /** Numeric detail so the UI can render `N rows past retention`. */
  count?: number;
  /** Human-readable narrative (English — DPO / regulator audience). */
  message: string;
}

export interface RetentionAuditPolicySnapshot {
  notificationRetentionDays: number;
  dataExportArchiveRetentionHours: number;
  terminatedUserAnonymizeDays: number;
}

export interface RetentionAuditCounters {
  /** Rows deleted by the worker during the period (from AuditLog aggregate). */
  notificationsPruned: number;
  usersAutoAnonymised: number;
  dsarArchivesExpired: number;
  /** Gap rows still present at snapshot time (from live table scans). */
  notificationsPastRetention: number;
  dsarArchivesPastRetention: number;
  terminatedUsersPastRetention: number;
}

export interface DerivedRetentionAudit {
  status: RetentionAuditStatus;
  findings: RetentionAuditFinding[];
}

/**
 * Derive the report status + machine-readable findings from the raw
 * inputs. Ordering is intentional so the UI can pick the highest-severity
 * finding first when rendering a summary chip.
 */
export function deriveRetentionAudit(input: {
  counters: RetentionAuditCounters;
  policy: RetentionAuditPolicySnapshot;
  workerLastRunAt: Date | null;
  periodStart: Date;
  periodEnd: Date;
}): DerivedRetentionAudit {
  const findings: RetentionAuditFinding[] = [];

  // Worker inactivity is the most severe signal — even if all counters
  // look clean, the absence of a tick means the sweep never ran. Ignore
  // when the policy is "keep forever" (all three thresholds = 0).
  const anyActionExpected = policyRequiresWork(input.policy);
  if (
    anyActionExpected &&
    !isWithinPeriod(input.workerLastRunAt, input.periodStart, input.periodEnd)
  ) {
    findings.push({
      kind: 'worker_inactive_during_period',
      severity: 'critical',
      message:
        'RetentionWorker did not tick during the audit period. Check the RETENTION_WORKER_ENABLED kill switch and the daily 02:00 UTC cron.',
    });
  }

  if (input.counters.notificationsPastRetention > 0) {
    findings.push({
      kind: 'notifications_past_retention',
      severity: 'warning',
      count: input.counters.notificationsPastRetention,
      message: `${input.counters.notificationsPastRetention} notification row(s) exceed the ${input.policy.notificationRetentionDays}-day retention window and remain on disk.`,
    });
  }

  if (input.counters.dsarArchivesPastRetention > 0) {
    findings.push({
      kind: 'dsar_archives_past_retention',
      severity: 'critical',
      count: input.counters.dsarArchivesPastRetention,
      message: `${input.counters.dsarArchivesPastRetention} DSAR archive(s) past their ${input.policy.dataExportArchiveRetentionHours}-hour expiry still hold a fileKey — the object was not unlinked from S3.`,
    });
  }

  if (input.counters.terminatedUsersPastRetention > 0) {
    findings.push({
      kind: 'terminated_users_past_retention',
      severity: 'warning',
      count: input.counters.terminatedUsersPastRetention,
      message: `${input.counters.terminatedUsersPastRetention} terminated user(s) past the ${input.policy.terminatedUserAnonymizeDays}-day threshold have not been anonymised.`,
    });
  }

  const status: RetentionAuditStatus = deriveStatus(findings);
  return { status, findings };
}

function deriveStatus(findings: RetentionAuditFinding[]): RetentionAuditStatus {
  if (findings.length === 0) return 'SUCCESS';
  if (findings.some((f) => f.kind === 'worker_inactive_during_period')) {
    return 'WORKER_INACTIVE';
  }
  return 'GAP_DETECTED';
}

function policyRequiresWork(policy: RetentionAuditPolicySnapshot): boolean {
  return (
    policy.notificationRetentionDays > 0 || policy.terminatedUserAnonymizeDays > 0
    // DSAR archive expiry is driven by DataExportWorker, not RetentionWorker,
    // so it does NOT count toward "worker did tick".
  );
}

function isWithinPeriod(ts: Date | null, periodStart: Date, periodEnd: Date): boolean {
  if (!ts) return false;
  const t = ts.getTime();
  return t >= periodStart.getTime() && t < periodEnd.getTime();
}

// ---------------------------------------------------------------------------
// Period math helpers — the worker converts "month N" into `[start, end)`.
// Kept here so it can be unit-tested without importing anything from luxon /
// date-fns. Everything below assumes UTC — DPO reports are month-boundary
// aligned and timezone drift is not worth the complexity for a single global
// registry.
// ---------------------------------------------------------------------------

/**
 * Return the UTC `[start, end)` boundaries for the calendar month preceding
 * `reference`. `reference` is typically the cron tick timestamp — e.g. if the
 * cron fires on 2026-04-01T05:30Z, this returns `[2026-03-01T00:00Z, 2026-04-01T00:00Z)`.
 */
export function previousUtcMonth(reference: Date): {
  periodStart: Date;
  periodEnd: Date;
} {
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth(); // 0..11
  const periodEnd = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const periodStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  return { periodStart, periodEnd };
}

/**
 * Same as `previousUtcMonth` but takes an explicit `(year, monthIndex1To12)`.
 * Useful for the manual regenerate endpoint that lets an operator specify
 * "regenerate the March 2026 report".
 */
export function utcMonthRange(
  year: number,
  monthIndex1To12: number,
): { periodStart: Date; periodEnd: Date } {
  if (monthIndex1To12 < 1 || monthIndex1To12 > 12) {
    throw new RangeError(`utcMonthRange: monthIndex1To12 must be 1..12, got ${monthIndex1To12}`);
  }
  const periodStart = new Date(Date.UTC(year, monthIndex1To12 - 1, 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(year, monthIndex1To12, 1, 0, 0, 0, 0));
  return { periodStart, periodEnd };
}
