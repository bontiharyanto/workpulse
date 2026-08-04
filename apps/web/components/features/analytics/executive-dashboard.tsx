'use client';

import { useQuery } from '@tanstack/react-query';
import type { AnalyticsMetricKey, AnalyticsWindowDays } from '@workpulse/shared-types';
import { ANALYTICS_WINDOW_OPTIONS } from '@workpulse/shared-types';
import { useState } from 'react';

import { analyticsAdminApi } from '@/lib/api-client';

import { KpiCard } from './kpi-card';
import { TrendChart } from './trend-chart';

const WINDOW_LABELS: Record<AnalyticsWindowDays, string> = {
  7: '7 hari',
  30: '30 hari',
  90: '90 hari',
  365: '1 tahun',
};

/**
 * Fase 33a — the main executive dashboard.
 *
 * Layout:
 *   * Header with window switcher (7 / 30 / 90 / 365).
 *   * Grid of KPI cards — each is clickable so the user can drill into
 *     a trend chart for that specific metric.
 *   * Timeseries chart at the bottom, sized to the same window.
 *
 * All fetches are React Query cached at 60s. The FE never mutates
 * anything on this page — it is a pure read surface.
 */
export function ExecutiveDashboard(): JSX.Element {
  const [windowDays, setWindowDays] = useState<AnalyticsWindowDays>(30);
  const [selectedMetric, setSelectedMetric] = useState<AnalyticsMetricKey | null>(null);

  const dashboard = useQuery({
    queryKey: ['analytics-dashboard', windowDays],
    queryFn: () => analyticsAdminApi.dashboard({ windowDays }),
    staleTime: 60_000,
  });

  const activeMetric = selectedMetric ?? dashboard.data?.tiles[0]?.metricKey ?? null;

  const trend = useQuery({
    queryKey: ['analytics-timeseries', activeMetric, windowDays],
    queryFn: () => {
      if (activeMetric == null) {
        throw new Error('trend queryFn should not run without an activeMetric');
      }
      return analyticsAdminApi.timeseries({
        metricKey: activeMetric,
        windowDays,
      });
    },
    enabled: activeMetric != null,
    staleTime: 60_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Ringkasan operasional</h2>
          <p className="text-muted-foreground text-sm">
            Angka-angka utama dihitung ulang setiap malam pukul 04:00 UTC. Hari ini dihitung
            real-time — pergerakan intraday langsung terlihat.
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Rentang waktu"
          className="border-border inline-flex rounded-md border p-0.5"
        >
          {ANALYTICS_WINDOW_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              role="tab"
              aria-selected={windowDays === n}
              onClick={() => setWindowDays(n)}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                windowDays === n
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {WINDOW_LABELS[n]}
            </button>
          ))}
        </div>
      </div>

      {dashboard.isLoading ? (
        <div
          role="status"
          aria-live="polite"
          className="border-border text-muted-foreground rounded-md border border-dashed p-6 text-sm"
        >
          Memuat data analitik…
        </div>
      ) : dashboard.data ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dashboard.data.tiles.map((tile) => (
              <KpiCard
                key={tile.metricKey}
                tile={tile}
                onSelect={() => setSelectedMetric(tile.metricKey)}
                isSelected={activeMetric === tile.metricKey}
              />
            ))}
          </div>

          <div className="border-border bg-card rounded-lg border p-4">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold">{trend.data?.label ?? 'Grafik tren'}</h3>
                <p className="text-muted-foreground text-xs">
                  {trend.data
                    ? `Data harian dari ${trend.data.window.from} sampai ${trend.data.window.to} (${trend.data.window.timezone}).`
                    : 'Klik salah satu tile di atas untuk memuat grafik.'}
                </p>
              </div>
              {dashboard.data.lastComputedAt && (
                <p className="text-muted-foreground text-[11px]">
                  Snapshot terakhir:{' '}
                  {new Date(dashboard.data.lastComputedAt).toLocaleString('id-ID')}
                </p>
              )}
            </div>
            {trend.isLoading ? (
              <div
                role="status"
                className="border-border text-muted-foreground rounded-md border border-dashed p-6 text-sm"
              >
                Memuat grafik…
              </div>
            ) : trend.data ? (
              <TrendChart
                points={trend.data.points}
                formatKind={trend.data.formatKind}
                fractionDigits={trend.data.fractionDigits}
                ariaLabel={`Grafik ${trend.data.label}`}
              />
            ) : (
              <div className="border-border text-muted-foreground rounded-md border border-dashed p-6 text-sm">
                Pilih tile KPI untuk melihat tren.
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="border-destructive/50 bg-destructive/5 text-destructive rounded-md border p-4 text-sm">
          Gagal memuat data dashboard.
        </div>
      )}
    </div>
  );
}
