'use client';

import { useId, type JSX } from 'react';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';

import { resolveChartColor, type ChartModule } from './chart-theme';

interface SparkLineProps {
  /** Ordered data points; higher indices = more recent. */
  data: readonly number[];
  /**
   * Semantic color name — one of `primary`, `success`, `warning`,
   * `destructive`, `info`, a module (`attendance` / `leave` / …),
   * or a chart palette slot (`chart-1`..`chart-5`).
   */
  color?:
    | 'primary'
    | 'success'
    | 'warning'
    | 'destructive'
    | 'info'
    | ChartModule
    | `chart-${1 | 2 | 3 | 4 | 5}`;
  /** Height in pixels. Default 32. */
  height?: number;
  className?: string;
  ariaLabel?: string;
}

/**
 * Tiny area chart, designed to nest INSIDE another surface (KPI card,
 * table cell). Deliberately no axes, no tooltip, no grid — the caller
 * always provides the label + value separately; the sparkline only
 * conveys shape.
 *
 * Rendered with a soft gradient fill so the shape reads even without
 * a solid area, and an explicit `stroke-width: 2` line on top so a
 * flat series remains visible.
 */
export function SparkLine({
  data,
  color = 'primary',
  height = 32,
  className,
  ariaLabel = 'Sparkline',
}: SparkLineProps): JSX.Element {
  const gradientId = useId();
  const rendered = data.map((value, index) => ({ index, value }));
  const stroke = resolveChartColor(color);

  return (
    <div className={className} aria-label={ariaLabel} role="img">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={rendered} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.32} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          {/*
           * `YAxis` is invisible but present so Recharts computes a
           * y-scale — otherwise a flat series (all values equal)
           * collapses to a horizontal line at the top of the box.
           */}
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
            activeDot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
