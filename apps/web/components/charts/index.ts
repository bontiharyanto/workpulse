/**
 * Chart primitives — shared visualization surface for every module.
 *
 * Import from `@/components/charts` rather than the individual files
 * so the barrel can hoist future re-organisations without touching
 * consumers. All primitives are theme-aware (read CSS vars for
 * colors, adapt automatically to light / dark) and format Indonesian
 * numbers via `Intl.NumberFormat('id-ID')`.
 */
export { DistributionBar } from './distribution-bar';
export { DonutChart } from './donut-chart';
export { EmptyChart } from './empty-chart';
export { KpiCard } from './kpi-card';
export { SparkLine } from './spark-line';
export { TrendChart } from './trend-chart';
export {
  CHART_PALETTE,
  MODULE_COLORS,
  SEMANTIC_COLORS,
  resolveChartColor,
  type ChartModule,
} from './chart-theme';
