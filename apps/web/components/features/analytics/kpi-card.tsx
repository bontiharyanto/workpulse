'use client';

import type { DashboardTile } from '@workpulse/shared-types';

import { formatDelta, formatDeltaPct, formatValue, trendArrow, trendClass } from './format-metric';

interface KpiCardProps {
  tile: DashboardTile;
  onSelect?: () => void;
  isSelected?: boolean;
}

/**
 * One KPI tile — headline value on top, comparison chip below. Renders
 * as a button when `onSelect` is provided so the parent can wire it up
 * to load a timeseries chart for the selected metric.
 */
export function KpiCard({ tile, onSelect, isSelected }: KpiCardProps): JSX.Element {
  const value = formatValue(tile.currentValue, tile.formatKind as never, tile.fractionDigits);
  const deltaSign = formatDelta(tile.delta.absolute, tile.formatKind as never, tile.fractionDigits);
  const deltaPct = formatDeltaPct(tile.delta.pct);
  const cls = trendClass(tile.delta.trend as never);
  const arrow = trendArrow(tile.delta.trend as never);

  const body = (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
          {tile.label}
        </p>
        <span className={`text-sm font-medium ${cls}`}>{arrow}</span>
      </div>
      <p className="text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
      <div className="text-muted-foreground mt-auto flex flex-wrap items-baseline gap-x-2 text-xs">
        <span className={`font-medium ${cls}`}>
          {deltaSign}
          {deltaPct ? ` (${deltaPct})` : ''}
        </span>
        <span>vs periode sebelumnya</span>
      </div>
    </div>
  );

  const base = 'rounded-lg border p-4 text-left transition-colors bg-card min-h-[130px]';
  const selectable = 'hover:border-primary/60 cursor-pointer';
  const selectedRing = isSelected ? 'border-primary ring-2 ring-primary/40' : 'border-border';

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={isSelected}
        title={tile.description}
        className={`${base} ${selectable} ${selectedRing}`}
      >
        {body}
      </button>
    );
  }
  return (
    <div title={tile.description} className={`${base} ${selectedRing}`}>
      {body}
    </div>
  );
}
