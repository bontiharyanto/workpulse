'use client';

import { type JSX } from 'react';

import { cn } from '@/lib/utils';

import { resolveChartColor, type ChartModule } from './chart-theme';

interface DistributionSegment {
  key: string;
  label: string;
  value: number;
  color?:
    | 'primary'
    | 'success'
    | 'warning'
    | 'destructive'
    | 'info'
    | ChartModule
    | `chart-${1 | 2 | 3 | 4 | 5}`;
}

interface DistributionBarProps {
  segments: readonly DistributionSegment[];
  /** Total for percentage math. Defaults to the sum of segment values. */
  total?: number;
  height?: number;
  className?: string;
  ariaLabel?: string;
  /** Show the legend below the bar. Default true. */
  showLegend?: boolean;
}

/**
 * Single horizontal stacked bar — the "at a glance" distribution
 * primitive. Best for showing how a whole is split across ≤5
 * categories: attendance status per day, leave request pipeline,
 * approval SLA buckets, etc.
 *
 * Uses plain divs (no Recharts) because a bar with 3-5 segments and
 * an optional legend is cheaper as flexbox — no SVG scale math
 * needed. Segments below 1% collapse to zero-width but retain
 * their legend entry.
 */
export function DistributionBar({
  segments,
  total,
  height = 12,
  className,
  ariaLabel = 'Distribusi',
  showLegend = true,
}: DistributionBarProps): JSX.Element {
  const sum = total ?? segments.reduce((acc, s) => acc + s.value, 0);
  const safeSum = sum > 0 ? sum : 1;

  return (
    <div className={cn('w-full', className)}>
      <div
        role="img"
        aria-label={ariaLabel}
        className="bg-muted flex w-full overflow-hidden rounded-full"
        style={{ height }}
      >
        {segments.map((seg, idx) => {
          const pct = (seg.value / safeSum) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={seg.key}
              className={cn(
                'transition-all duration-300',
                idx === 0 ? 'rounded-l-full' : '',
                idx === segments.length - 1 ? 'rounded-r-full' : '',
              )}
              style={{
                width: `${pct}%`,
                backgroundColor: resolveChartColor(
                  seg.color ?? `chart-${((idx % 5) + 1) as 1 | 2 | 3 | 4 | 5}`,
                ),
              }}
              title={`${seg.label}: ${seg.value.toLocaleString('id-ID')} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>

      {showLegend ? (
        <ul className="text-caption mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {segments.map((seg, idx) => (
            <li key={seg.key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: resolveChartColor(
                    seg.color ?? `chart-${((idx % 5) + 1) as 1 | 2 | 3 | 4 | 5}`,
                  ),
                }}
              />
              <span className="text-muted-foreground">{seg.label}</span>
              <span className="text-foreground font-medium tabular-nums">
                {seg.value.toLocaleString('id-ID')}
              </span>
              <span className="text-muted-foreground/70 text-[10px] tabular-nums">
                ({((seg.value / safeSum) * 100).toFixed(1)}%)
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
