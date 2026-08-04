'use client';

import type { DashboardTile } from '@workpulse/shared-types';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { type JSX, type ReactNode } from 'react';

import {
  formatDelta,
  formatDeltaPct,
  formatValue,
} from '@/components/features/analytics/format-metric';
import { CountUp } from '@/components/motion/motion-primitives';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { type ChartModule } from './chart-theme';
import { SparkLine } from './spark-line';

interface KpiCardProps {
  tile: DashboardTile;
  /** Historical values used to render an inline sparkline. Optional. */
  sparklineData?: readonly number[];
  /** Selected state for tab-like tile grids (drilldown target). */
  isSelected?: boolean;
  onSelect?: () => void;
  /** Force a specific accent color; defaults to inferring from trend. */
  accent?:
    | 'primary'
    | 'success'
    | 'warning'
    | 'destructive'
    | 'info'
    | ChartModule
    | `chart-${1 | 2 | 3 | 4 | 5}`;
  className?: string;
}

/**
 * Composite KPI card — overline label + big number (with count-up
 * animation on mount) + delta pill with directional arrow + optional
 * sparkline showing the trailing window.
 *
 * Delta color mapping is DIRECTION-aware:
 *   - `HIGHER_IS_BETTER` metric going UP → success (green)
 *   - `HIGHER_IS_BETTER` metric going DOWN → destructive (red)
 *   - `LOWER_IS_BETTER` metric going UP → destructive
 *   - `LOWER_IS_BETTER` metric going DOWN → success
 *   - `NEUTRAL` → muted
 * All handled by the server through `tile.delta.trend`, but the
 * rendering here only asks whether the trend is `_GOOD` or `_BAD`,
 * decoupling us from metric-specific logic.
 *
 * Interactive mode: when `onSelect` is provided, the card renders as
 * a button and gains a hover lift + a persistent ring when
 * `isSelected` is true.
 */
export function KpiCard({
  tile,
  sparklineData,
  isSelected,
  onSelect,
  accent,
  className,
}: KpiCardProps): JSX.Element {
  const trend = tile.delta.trend;
  const isGood = trend === 'UP_GOOD' || trend === 'DOWN_GOOD';
  const isBad = trend === 'UP_BAD' || trend === 'DOWN_BAD';
  const isFlat = trend === 'FLAT';

  const deltaColorClass = isGood
    ? 'text-success'
    : isBad
      ? 'text-destructive'
      : 'text-muted-foreground';
  const deltaBgClass = isGood ? 'bg-success/10' : isBad ? 'bg-destructive/10' : 'bg-muted';

  const ArrowIcon = isFlat
    ? Minus
    : trend === 'UP_GOOD' || trend === 'UP_BAD'
      ? ArrowUp
      : ArrowDown;

  const sparklineColor = accent ?? (isGood ? 'success' : isBad ? 'destructive' : 'primary');

  const bodyContent = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-muted-foreground text-overline uppercase">{tile.label}</p>
        <span
          className={cn(
            'inline-flex h-6 w-6 items-center justify-center rounded-full',
            deltaBgClass,
            deltaColorClass,
          )}
          aria-hidden
        >
          <ArrowIcon className="h-3.5 w-3.5" />
        </span>
      </div>

      <div className="mt-1 flex items-baseline gap-2">
        <p className="text-display-sm text-foreground tabular-nums">
          <KpiValue tile={tile} />
        </p>
      </div>

      <div className="text-muted-foreground text-caption mt-1 flex flex-wrap items-baseline gap-x-1.5">
        <span className={cn('font-medium tabular-nums', deltaColorClass)}>
          {formatDelta(tile.delta.absolute, tile.formatKind, tile.fractionDigits)}
          {tile.delta.pct != null ? ` (${formatDeltaPct(tile.delta.pct)})` : ''}
        </span>
        <span>vs periode sebelumnya</span>
      </div>

      {sparklineData && sparklineData.length > 1 ? (
        <div className="mt-3">
          <SparkLine
            data={sparklineData}
            color={sparklineColor}
            height={40}
            ariaLabel={`Tren ${tile.label} pada rentang terpilih`}
          />
        </div>
      ) : null}
    </>
  );

  const baseClasses = cn(
    'group relative flex h-full flex-col p-5 text-left',
    isSelected && 'ring-2 ring-primary/50 border-primary/60',
    className,
  );

  if (onSelect) {
    return (
      <Card
        interactive
        aria-pressed={isSelected}
        aria-label={`Pilih metrik ${tile.label}`}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        role="button"
        tabIndex={0}
        title={tile.description}
        className={baseClasses}
      >
        {bodyContent}
      </Card>
    );
  }

  return (
    <Card className={baseClasses} title={tile.description}>
      {bodyContent}
    </Card>
  );
}

/**
 * Splits `formatValue`'s output into the numeric prefix + unit suffix
 * so `CountUp` can animate only the number part. E.g. `"99.5 jam"`
 * yields `<CountUp value={99.5}> jam</CountUp>`.
 *
 * `CURRENCY_IDR` is a special case: `Intl.NumberFormat.currency`
 * inserts thousand separators AND the "Rp" prefix, so we render the
 * whole formatted string via CountUp's `format` callback.
 */
function KpiValue({ tile }: { tile: DashboardTile }): ReactNode {
  const { currentValue, formatKind, fractionDigits } = tile;

  return (
    <CountUp
      value={currentValue}
      duration={0.7}
      format={(n) => formatValue(n, formatKind, fractionDigits)}
    />
  );
}
