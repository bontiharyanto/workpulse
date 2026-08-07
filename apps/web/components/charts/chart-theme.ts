/**
 * Chart theming — bridges CSS variables (`--chart-1..5`, `--module-*`,
 * `--success` / `--warning` / `--destructive`) to Recharts, which
 * accepts only literal color strings, not CSS `var()`.
 *
 * Every chart primitive imports from here — never hard-codes hex or
 * Tailwind color classes. Ensures automatic dark-mode adaptation and
 * a single audit point when the palette changes.
 *
 * Because Recharts renders inside SVG (which does NOT inherit
 * `currentColor` for the `<g>` element itself), we bind colors via
 * inline hsl(var(--…)) strings.
 */

export const CHART_PALETTE = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
] as const;

export const MODULE_COLORS = {
  attendance: 'hsl(var(--module-attendance))',
  leave: 'hsl(var(--module-leave))',
  overtime: 'hsl(var(--module-overtime))',
  timesheet: 'hsl(var(--module-timesheet))',
  admin: 'hsl(var(--module-admin))',
} as const;

export const SEMANTIC_COLORS = {
  primary: 'hsl(var(--primary))',
  success: 'hsl(var(--success))',
  warning: 'hsl(var(--warning))',
  info: 'hsl(var(--info))',
  destructive: 'hsl(var(--destructive))',
  muted: 'hsl(var(--muted-foreground))',
  border: 'hsl(var(--border))',
  foreground: 'hsl(var(--foreground))',
  mutedForeground: 'hsl(var(--muted-foreground))',
  background: 'hsl(var(--background))',
} as const;

export type ChartModule = keyof typeof MODULE_COLORS;

/**
 * Resolve a semantic color name to a `hsl(var(...))` string usable
 * by Recharts props (`stroke`, `fill`, `dot={{ fill: … }}`).
 *
 * ```ts
 *   <Area stroke={resolveChartColor('primary')} />
 * ```
 */
export function resolveChartColor(
  name: keyof typeof SEMANTIC_COLORS | ChartModule | `chart-${1 | 2 | 3 | 4 | 5}`,
): string {
  if (name in SEMANTIC_COLORS) {
    return SEMANTIC_COLORS[name as keyof typeof SEMANTIC_COLORS];
  }
  if (name in MODULE_COLORS) {
    return MODULE_COLORS[name as ChartModule];
  }
  const idx = Number(name.split('-')[1]) - 1;
  return CHART_PALETTE[idx] ?? CHART_PALETTE[0];
}
