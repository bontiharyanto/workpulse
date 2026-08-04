'use client';

import type { MetricFormatKind, TimeseriesPoint } from '@workpulse/shared-types';
import { useId, useMemo, type JSX } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { formatValue } from '@/components/features/analytics/format-metric';
import { cn } from '@/lib/utils';

import { resolveChartColor, type ChartModule } from './chart-theme';

interface TrendChartProps {
  points: readonly TimeseriesPoint[];
  formatKind: MetricFormatKind;
  fractionDigits: number;
  /** Semantic color. Default `primary`. */
  color?:
    | 'primary'
    | 'success'
    | 'warning'
    | 'destructive'
    | 'info'
    | ChartModule
    | `chart-${1 | 2 | 3 | 4 | 5}`;
  height?: number;
  className?: string;
  ariaLabel?: string;
}

/**
 * Full-size time-series chart, replaces the Fase 33a dependency-free
 * SVG implementation. Uses Recharts for cross-hairs, hover tooltip,
 * axis label collision avoidance, and responsive sizing.
 *
 * Axis strategy:
 *   - Show first + last date only on the X axis + one center label
 *     if the window is >30 days. Keeps the axis quiet.
 *   - Y axis shows 3 evenly-spaced ticks with formatted values.
 *   - Grid: horizontal only, dashed, at Y ticks. No vertical grid.
 *
 * Tooltip: custom shadcn-styled component so it inherits our
 * popover shadow + rounded-lg + typography tokens.
 */
export function TrendChart({
  points,
  formatKind,
  fractionDigits,
  color = 'primary',
  height = 260,
  className,
  ariaLabel,
}: TrendChartProps): JSX.Element {
  const gradientId = useId();
  const stroke = resolveChartColor(color);

  const data = useMemo(
    () =>
      points.map((p) => ({
        date: p.date,
        value: p.value,
        isToday: p.isToday,
      })),
    [points],
  );

  const xTicks = useMemo(() => {
    if (data.length === 0) return [];
    if (data.length <= 2) return data.map((d) => d.date);
    // `data.length` proven >= 3 here; `.at()` returns `T | undefined`
    // so we still guard with `?? ''` (defensive, cannot fire).
    const first = data.at(0)?.date ?? '';
    const last = data.at(-1)?.date ?? '';
    const mid = data.at(Math.floor(data.length / 2))?.date ?? '';
    return data.length > 14 ? [first, mid, last] : [first, last];
  }, [data]);

  if (data.length === 0) {
    return (
      <div
        role="status"
        className={cn(
          'border-border text-muted-foreground text-body flex items-center justify-center rounded-md border border-dashed p-6',
          className,
        )}
        style={{ height }}
      >
        Belum ada data untuk ditampilkan.
      </div>
    );
  }

  return (
    <div className={cn('w-full', className)} aria-label={ariaLabel} role="img">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
              <stop offset="95%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid
            vertical={false}
            stroke="hsl(var(--border))"
            strokeDasharray="3 3"
            strokeOpacity={0.6}
          />

          <XAxis
            dataKey="date"
            ticks={xTicks}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(iso: string) =>
              new Date(iso).toLocaleDateString('id-ID', {
                day: '2-digit',
                month: 'short',
              })
            }
            padding={{ left: 8, right: 8 }}
          />

          <YAxis
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={44}
            tickCount={4}
            tickFormatter={(v: number) => formatValue(v, formatKind, fractionDigits)}
          />

          <Tooltip
            cursor={{
              stroke: 'hsl(var(--border))',
              strokeWidth: 1,
              strokeDasharray: '3 3',
            }}
            content={<TrendTooltip formatKind={formatKind} fractionDigits={fractionDigits} />}
          />

          <Area
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            isAnimationActive
            animationDuration={400}
            dot={false}
            activeDot={{
              r: 4,
              stroke: 'hsl(var(--background))',
              strokeWidth: 2,
              fill: stroke,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Recharts injects `active` and `payload` into any node passed as
 * the `content` prop of `<Tooltip>`. Their public `TooltipProps`
 * type has churned across versions, so we declare the fields we
 * care about directly instead of extending it.
 */
interface TrendTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: { date: string; value: number; isToday: boolean } }>;
  formatKind: MetricFormatKind;
  fractionDigits: number;
}

function TrendTooltip({
  active,
  payload,
  formatKind,
  fractionDigits,
}: TrendTooltipProps): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const first = payload[0];
  const raw = first?.payload;
  if (!raw) return null;

  return (
    <div className="bg-popover text-popover-foreground border-border animate-fade-in shadow-popover rounded-lg border p-3">
      <p className="text-caption text-muted-foreground">
        {new Date(raw.date).toLocaleDateString('id-ID', {
          weekday: 'short',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })}
      </p>
      <p className="text-h5 text-foreground tabular-nums">
        {formatValue(raw.value, formatKind, fractionDigits)}
      </p>
      {raw.isToday ? (
        <p className="text-caption text-primary mt-1 font-medium">Hari ini · live</p>
      ) : null}
    </div>
  );
}
