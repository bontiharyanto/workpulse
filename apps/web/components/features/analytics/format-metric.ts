import type { MetricFormatKind, MetricTrend } from '@workpulse/shared-types';

/**
 * Fase 33a — shared value + delta formatters. Centralised so KpiCard,
 * TrendChart and Timeseries tooltips agree on rendering.
 */

const idrFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

const numberFormatter = (fractionDigits: number) =>
  new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });

/** Render the metric value in the right shape for its formatKind. */
export function formatValue(
  value: number,
  formatKind: MetricFormatKind,
  fractionDigits: number,
): string {
  if (formatKind === 'CURRENCY_IDR') {
    return idrFormatter.format(value);
  }
  if (formatKind === 'RATIO_PCT') {
    // Server sends fractions (0.98). Multiply for display.
    return `${numberFormatter(fractionDigits).format(value * 100)}%`;
  }
  if (formatKind === 'HOURS') {
    return `${numberFormatter(fractionDigits).format(value)} jam`;
  }
  return numberFormatter(fractionDigits).format(value);
}

/** Signed value used on the delta chip. */
export function formatDelta(
  absolute: number,
  formatKind: MetricFormatKind,
  fractionDigits: number,
): string {
  if (absolute === 0) return '±0';
  const sign = absolute > 0 ? '+' : '−';
  const magnitude = Math.abs(absolute);
  return `${sign}${formatValue(magnitude, formatKind, fractionDigits)}`;
}

/** Percentage suffix — "(+12.4%)". Returns empty string when null. */
export function formatDeltaPct(pct: number | null): string {
  if (pct == null) return '';
  const rounded = Math.abs(pct * 100).toFixed(1);
  const sign = pct > 0 ? '+' : '−';
  return `${sign}${rounded}%`;
}

const TREND_CLASS: Record<MetricTrend, string> = {
  UP_GOOD: 'text-emerald-600 dark:text-emerald-400',
  UP_BAD: 'text-red-600 dark:text-red-400',
  DOWN_GOOD: 'text-emerald-600 dark:text-emerald-400',
  DOWN_BAD: 'text-red-600 dark:text-red-400',
  FLAT: 'text-muted-foreground',
};

const TREND_ARROW: Record<MetricTrend, string> = {
  UP_GOOD: '▲',
  UP_BAD: '▲',
  DOWN_GOOD: '▼',
  DOWN_BAD: '▼',
  FLAT: '■',
};

export function trendClass(trend: MetricTrend): string {
  return TREND_CLASS[trend];
}

export function trendArrow(trend: MetricTrend): string {
  return TREND_ARROW[trend];
}
