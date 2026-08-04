import type { MetricDirection } from './metric-keys';

/**
 * Fase 33a — pure delta helpers for period-over-period comparisons.
 *
 * The dashboard shows every KPI tile with (currentValue, deltaValue,
 * deltaPct, trend). This module owns the maths so both the query
 * service and unit tests can share a single truth.
 */

export interface Delta {
  /** Signed absolute change (current − previous). */
  absolute: number;
  /**
   * Signed relative change vs `previous`, expressed as a fraction.
   * Null when `previous === 0` — the FE renders "—" instead of ∞.
   */
  pct: number | null;
  /**
   * How to colour the delta arrow given the metric's semantics. Never
   * derive this at the FE — the caller passes the metric direction and
   * this module returns the tri-state.
   */
  trend: 'UP_GOOD' | 'UP_BAD' | 'DOWN_GOOD' | 'DOWN_BAD' | 'FLAT';
}

const EPSILON = 1e-9;

export function computeDelta(current: number, previous: number, direction: MetricDirection): Delta {
  const absolute = current - previous;
  const pct = Math.abs(previous) < EPSILON ? null : (current - previous) / previous;

  let trend: Delta['trend'];
  if (Math.abs(absolute) < EPSILON) {
    trend = 'FLAT';
  } else if (direction === 'NEUTRAL') {
    trend = absolute > 0 ? 'UP_GOOD' : 'DOWN_GOOD';
  } else if (direction === 'HIGHER_IS_BETTER') {
    trend = absolute > 0 ? 'UP_GOOD' : 'DOWN_BAD';
  } else {
    // LOWER_IS_BETTER
    trend = absolute > 0 ? 'UP_BAD' : 'DOWN_GOOD';
  }
  return { absolute, pct, trend };
}

/**
 * Aggregate a sequence of daily values for display in the KPI tile
 * "current" number.
 *
 * The rule:
 *   * COUNT / HOURS / CURRENCY_IDR → **sum** of daily values in the window.
 *   * RATIO_PCT → **average** of daily values in the window (unweighted;
 *     the FE never has enough day-mix info to weight fairly, and the
 *     nightly worker already normalised each day to a fraction).
 *   * HEADCOUNT_ACTIVE / HEADCOUNT_TERMINATED — the caller inspects the
 *     **latest** value in the window, not the sum. This function returns
 *     that via `mode: 'LAST'`.
 *
 * `AggregationMode` is the caller's responsibility so we don't couple
 * to metric names in this module — the query service maps
 * `MetricDescriptor.formatKind` (plus a hand-curated headcount override)
 * to the mode.
 */
export type AggregationMode = 'SUM' | 'AVG' | 'LAST';

export function aggregate(values: number[], mode: AggregationMode): number {
  if (values.length === 0) return 0;
  switch (mode) {
    case 'SUM':
      return values.reduce((a, b) => a + b, 0);
    case 'AVG':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'LAST':
      return values[values.length - 1]!;
  }
}
