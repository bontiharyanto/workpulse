'use client';

import { useMemo, type JSX } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { cn } from '@/lib/utils';

import { resolveChartColor, type ChartModule } from './chart-theme';

interface DonutSlice {
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

interface DonutChartProps {
  data: readonly DonutSlice[];
  /** Big number rendered in the middle. Optional. */
  centerValue?: string | number;
  /** Small label under the center value. */
  centerLabel?: string;
  height?: number;
  className?: string;
  ariaLabel?: string;
}

/**
 * Donut chart — categorical breakdown with room for a headline
 * number in the middle. Perfect for leave-type distributions,
 * attendance status splits, overtime pre- vs post-approval ratios.
 *
 * The inner radius is fixed at 62% of outer — a "chunky donut"
 * that leaves ~35px vertical room in the middle for text at
 * height=180.
 */
export function DonutChart({
  data,
  centerValue,
  centerLabel,
  height = 180,
  className,
  ariaLabel = 'Donut chart',
}: DonutChartProps): JSX.Element {
  const total = useMemo(() => data.reduce((acc, s) => acc + s.value, 0), [data]);

  return (
    <div className={cn('relative w-full', className)} aria-label={ariaLabel} role="img">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data as DonutSlice[]}
            dataKey="value"
            innerRadius="62%"
            outerRadius="95%"
            paddingAngle={data.length > 1 ? 1.5 : 0}
            strokeWidth={0}
            isAnimationActive
            animationDuration={500}
          >
            {data.map((slice, idx) => (
              <Cell
                key={slice.key}
                fill={resolveChartColor(
                  slice.color ?? `chart-${((idx % 5) + 1) as 1 | 2 | 3 | 4 | 5}`,
                )}
              />
            ))}
          </Pie>
          <Tooltip content={<DonutTooltip total={total} />} />
        </PieChart>
      </ResponsiveContainer>

      {centerValue != null ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-h2 text-foreground tabular-nums">{centerValue}</span>
          {centerLabel ? (
            <span className="text-caption text-muted-foreground">{centerLabel}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * See the note in `trend-chart.tsx::TrendTooltip` — Recharts
 * injects `active` + `payload` but their public `TooltipProps` type
 * has churned across versions, so we declare only what we need.
 */
interface DonutTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: DonutSlice }>;
  total: number;
}

function DonutTooltip({ active, payload, total }: DonutTooltipProps): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const first = payload[0];
  const raw = first?.payload;
  if (!raw) return null;
  const pct = total > 0 ? ((raw.value / total) * 100).toFixed(1) : '0';

  return (
    <div className="bg-popover text-popover-foreground border-border animate-fade-in shadow-popover rounded-lg border p-2.5">
      <p className="text-caption text-muted-foreground">{raw.label}</p>
      <p className="text-h6 text-foreground tabular-nums">
        {raw.value.toLocaleString('id-ID')}{' '}
        <span className="text-muted-foreground text-caption font-normal">({pct}%)</span>
      </p>
    </div>
  );
}
