import { AnalyticsMetricKey } from '@prisma/client';

/**
 * Fase 33a — canonical KPI catalogue.
 *
 * Every metric the executive dashboard renders bottoms out here.
 * Keeping the list in a single frozen module means:
 *   1. Wire format stability: adding a new metric requires touching this
 *      file, the Prisma enum, and shared-types in the same PR.
 *   2. FE + BE agree on `formatKind` — the FE renders `RATIO_PCT` values
 *      by multiplying by 100 and appending `%`, `COUNT` values as
 *      integers, and `CURRENCY_IDR` values with `Intl.NumberFormat`.
 *
 * NEVER derive `formatKind` from `metricKey` at the call site — always
 * consult `METRIC_DESCRIPTORS[key]`. That keeps the FE contract
 * one-hop-away and makes rebranding a metric a compile-time refactor.
 */

/** How the FE should render the numeric value. */
export type MetricFormatKind = 'RATIO_PCT' | 'COUNT' | 'HOURS' | 'CURRENCY_IDR';

/**
 * Direction that is considered "good" for a metric. Delta rendering
 * uses this to colour arrows green/red without asking the FE to remember
 * per-metric semantics.
 *
 *   HIGHER_IS_BETTER — e.g. on-time rate, headcount active.
 *   LOWER_IS_BETTER  — e.g. late count, absent count, overtime cost.
 *   NEUTRAL          — e.g. leave days approved (business context varies).
 */
export type MetricDirection =
  | 'HIGHER_IS_BETTER'
  | 'LOWER_IS_BETTER'
  | 'NEUTRAL';

export interface MetricDescriptor {
  key: AnalyticsMetricKey;
  /** Short Indonesian label for FE tiles. */
  label: string;
  /** Longer English description for tooltips + API docs. */
  description: string;
  formatKind: MetricFormatKind;
  direction: MetricDirection;
  /**
   * Number of fractional digits the FE should preserve when displaying.
   * The DB always stores 4dp; this is purely a presentation hint.
   */
  fractionDigits: number;
}

const D = (
  key: AnalyticsMetricKey,
  label: string,
  description: string,
  formatKind: MetricFormatKind,
  direction: MetricDirection,
  fractionDigits: number,
): MetricDescriptor => ({
  key,
  label,
  description,
  formatKind,
  direction,
  fractionDigits,
});

export const METRIC_DESCRIPTORS: Record<AnalyticsMetricKey, MetricDescriptor> =
  {
    ATTENDANCE_ON_TIME_RATE: D(
      'ATTENDANCE_ON_TIME_RATE',
      'On-time rate',
      'Share of clock-ins on the given day flagged ON_TIME. Excludes LATE, EARLY_LEAVE, ABSENT, ON_LEAVE.',
      'RATIO_PCT',
      'HIGHER_IS_BETTER',
      2,
    ),
    ATTENDANCE_LATE_COUNT: D(
      'ATTENDANCE_LATE_COUNT',
      'Terlambat',
      'Absolute count of attendance records flagged LATE on the given day.',
      'COUNT',
      'LOWER_IS_BETTER',
      0,
    ),
    ATTENDANCE_ABSENT_COUNT: D(
      'ATTENDANCE_ABSENT_COUNT',
      'Tanpa keterangan',
      'Absolute count of AbsenceRecord entries whose workDate is the given day.',
      'COUNT',
      'LOWER_IS_BETTER',
      0,
    ),
    LEAVE_PENDING_COUNT: D(
      'LEAVE_PENDING_COUNT',
      'Cuti pending',
      'Leave requests still in PENDING_SUPERVISOR or PENDING_HR as of the given day (open-ended snapshot).',
      'COUNT',
      'LOWER_IS_BETTER',
      0,
    ),
    LEAVE_DAYS_APPROVED: D(
      'LEAVE_DAYS_APPROVED',
      'Cuti disetujui (hari)',
      'Total approved leave days whose startDate falls on the given day.',
      'COUNT',
      'NEUTRAL',
      0,
    ),
    OVERTIME_HOURS: D(
      'OVERTIME_HOURS',
      'Lembur (jam)',
      'Total approved overtime hours logged with workDate on the given day.',
      'HOURS',
      'NEUTRAL',
      2,
    ),
    OVERTIME_COST_IDR: D(
      'OVERTIME_COST_IDR',
      'Biaya lembur',
      'Total approved overtime cost (baseRate × multiplier × hours) in IDR on the given day.',
      'CURRENCY_IDR',
      'LOWER_IS_BETTER',
      0,
    ),
    HEADCOUNT_ACTIVE: D(
      'HEADCOUNT_ACTIVE',
      'Headcount aktif',
      'Snapshot of active (deletedAt IS NULL) employees at end-of-day on the given date.',
      'COUNT',
      'HIGHER_IS_BETTER',
      0,
    ),
    HEADCOUNT_TERMINATED: D(
      'HEADCOUNT_TERMINATED',
      'Terminasi',
      'Users terminated on the given day (User.deletedAt within the day boundary).',
      'COUNT',
      'LOWER_IS_BETTER',
      0,
    ),
  };

/** Frozen list of every metric — the executive dashboard iterates this. */
export const METRIC_KEYS: readonly AnalyticsMetricKey[] = Object.freeze(
  Object.keys(METRIC_DESCRIPTORS) as AnalyticsMetricKey[],
);

/**
 * Type guard used at the API boundary — Query params come in as strings
 * and NestJS's built-in `ParseEnumPipe` does the same work but requires
 * the enum reference; this is handier when we accept comma-separated
 * lists of keys.
 */
export function isAnalyticsMetricKey(v: string): v is AnalyticsMetricKey {
  return Object.hasOwn(METRIC_DESCRIPTORS, v);
}
