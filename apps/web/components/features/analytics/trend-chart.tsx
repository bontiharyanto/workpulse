'use client';

import { useMemo, useState } from 'react';
import type {
  MetricFormatKind,
  TimeseriesPoint,
} from '@workpulse/shared-types';

import { formatValue } from './format-metric';

interface TrendChartProps {
  points: TimeseriesPoint[];
  formatKind: MetricFormatKind;
  fractionDigits: number;
  height?: number;
  ariaLabel: string;
}

const PADDING_X = 32;
const PADDING_Y_TOP = 12;
const PADDING_Y_BOTTOM = 24;
const WIDTH = 720;

/**
 * Lightweight SVG line chart. Deliberately dependency-free — recharts /
 * chart.js would add ~40-60 KB gzipped, and Fase 33a only needs one
 * clean line plus a hover tooltip. If a future phase needs stacked bars
 * or brushes, we can swap this out then.
 *
 * Interactions:
 *   * Hover over a point → tooltip shows date + formatted value.
 *   * Today's data point is rendered in a slightly larger radius +
 *     accent stroke so it's visually distinct from historical days.
 */
export function TrendChart({
  points,
  formatKind,
  fractionDigits,
  height = 240,
  ariaLabel,
}: TrendChartProps): JSX.Element {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const view = useMemo(() => {
    if (points.length === 0) return null;
    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max === min ? 1 : max - min;
    const innerW = WIDTH - PADDING_X * 2;
    const innerH = height - PADDING_Y_TOP - PADDING_Y_BOTTOM;
    const stepX = points.length > 1 ? innerW / (points.length - 1) : innerW;

    const coords = points.map((p, i) => {
      const x = PADDING_X + i * stepX;
      const y =
        PADDING_Y_TOP +
        innerH -
        ((p.value - min) / range) * innerH;
      return { x, y, point: p };
    });

    const pathD = coords
      .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
      .join(' ');

    const areaD =
      pathD +
      ` L ${coords[coords.length - 1]!.x.toFixed(2)} ${height - PADDING_Y_BOTTOM}` +
      ` L ${coords[0]!.x.toFixed(2)} ${height - PADDING_Y_BOTTOM} Z`;

    return { coords, pathD, areaD, min, max, innerH };
  }, [points, height]);

  if (!view) {
    return (
      <div
        role="status"
        className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground"
      >
        Belum ada data untuk ditampilkan.
      </div>
    );
  }

  const firstLabel = points[0]!.date;
  const lastLabel = points[points.length - 1]!.date;
  const hover = hoverIdx != null ? view.coords[hoverIdx] : null;

  return (
    <div className="relative w-full">
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="none"
        className="h-auto w-full"
      >
        <defs>
          <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Horizontal gridlines: min + max */}
        <line
          x1={PADDING_X}
          y1={PADDING_Y_TOP}
          x2={WIDTH - PADDING_X}
          y2={PADDING_Y_TOP}
          className="stroke-border"
          strokeDasharray="3 3"
        />
        <line
          x1={PADDING_X}
          y1={height - PADDING_Y_BOTTOM}
          x2={WIDTH - PADDING_X}
          y2={height - PADDING_Y_BOTTOM}
          className="stroke-border"
          strokeDasharray="3 3"
        />

        <path
          d={view.areaD}
          className="fill-primary text-primary"
          fill="url(#trendFill)"
        />
        <path
          d={view.pathD}
          className="stroke-primary"
          strokeWidth={2}
          fill="none"
        />

        {view.coords.map((c, i) => {
          const isToday = c.point.isToday;
          const isActive = hoverIdx === i;
          return (
            <g key={c.point.date}>
              <circle
                cx={c.x}
                cy={c.y}
                r={isToday || isActive ? 5 : 3}
                className={
                  isToday
                    ? 'fill-primary stroke-background'
                    : 'fill-primary stroke-background'
                }
                strokeWidth={isToday ? 2 : 1}
              />
              {/* Wider transparent hitbox for hover UX. */}
              <rect
                x={c.x - 12}
                y={PADDING_Y_TOP}
                width={24}
                height={height - PADDING_Y_TOP - PADDING_Y_BOTTOM}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx((v) => (v === i ? null : v))}
              />
            </g>
          );
        })}

        {/* Date axis labels — first + last only, to keep the axis clean. */}
        <text
          x={PADDING_X}
          y={height - 6}
          className="fill-muted-foreground text-[10px]"
        >
          {firstLabel}
        </text>
        <text
          x={WIDTH - PADDING_X}
          y={height - 6}
          textAnchor="end"
          className="fill-muted-foreground text-[10px]"
        >
          {lastLabel}
        </text>

        {/* Y-axis min/max labels */}
        <text
          x={PADDING_X - 6}
          y={PADDING_Y_TOP + 4}
          textAnchor="end"
          className="fill-muted-foreground text-[10px]"
        >
          {formatValue(view.max, formatKind, fractionDigits)}
        </text>
        <text
          x={PADDING_X - 6}
          y={height - PADDING_Y_BOTTOM}
          textAnchor="end"
          className="fill-muted-foreground text-[10px]"
        >
          {formatValue(view.min, formatKind, fractionDigits)}
        </text>
      </svg>

      {hover && (
        <div
          role="tooltip"
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-md"
          style={{
            left: `${(hover.x / WIDTH) * 100}%`,
            top: `${(hover.y / height) * 100}%`,
          }}
        >
          <div className="font-medium">{hover.point.date}</div>
          <div className="tabular-nums">
            {formatValue(hover.point.value, formatKind, fractionDigits)}
          </div>
          {hover.point.isToday && (
            <div className="text-[10px] text-muted-foreground">
              (data hari ini — live)
            </div>
          )}
        </div>
      )}
    </div>
  );
}
