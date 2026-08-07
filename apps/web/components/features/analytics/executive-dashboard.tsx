'use client';

import { useQuery } from '@tanstack/react-query';
import type { AnalyticsMetricKey, AnalyticsWindowDays } from '@workpulse/shared-types';
import { ANALYTICS_WINDOW_OPTIONS } from '@workpulse/shared-types';
import { CalendarClock, RefreshCw } from 'lucide-react';
import { useState, type JSX } from 'react';

import { EmptyChart, KpiCard, TrendChart } from '@/components/charts';
import { PageHeader } from '@/components/layout/page-header';
import { FadeIn } from '@/components/motion/motion-primitives';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { analyticsAdminApi } from '@/lib/api-client';

const WINDOW_LABELS: Record<AnalyticsWindowDays, string> = {
  7: '7 hari',
  30: '30 hari',
  90: '90 hari',
  365: '1 tahun',
};

/**
 * Executive KPI Dashboard (Fase 3 rework).
 *
 * Layout:
 *   1. PageHeader with title + description + refresh + window tabs.
 *   2. Grid of KPI cards — each carries a sparkline of its own
 *      timeseries when the trend fetch has cached data for that
 *      metric+window. Click a card to select it as the active
 *      metric for the big chart below.
 *   3. Section card with the full-size TrendChart for the active
 *      metric.
 *
 * Data flow unchanged from Fase 33a — same two React Query hooks
 * (`analyticsAdminApi.dashboard` for tiles, `.timeseries` for the
 * trend), same 60s staleTime. Only the visual layer swapped.
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

  const lastComputedAt = dashboard.data?.lastComputedAt;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Executive Dashboard"
        description="Ringkasan operasional lintas modul: kehadiran, cuti, lembur, dan headcount. Data historis dari snapshot semalaman + hari ini real-time."
        actions={
          <div className="flex items-center gap-2">
            <Tabs
              value={String(windowDays)}
              onValueChange={(v) => setWindowDays(Number(v) as AnalyticsWindowDays)}
            >
              <TabsList>
                {ANALYTICS_WINDOW_OPTIONS.map((n) => (
                  <TabsTrigger key={n} value={String(n)}>
                    {WINDOW_LABELS[n]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <button
              type="button"
              onClick={() => void dashboard.refetch()}
              disabled={dashboard.isFetching}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring focus-visible:ring-offset-background inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50"
              aria-label="Muat ulang"
              title="Muat ulang data"
            >
              <RefreshCw
                className={`h-4 w-4 ${dashboard.isFetching ? 'animate-spin' : ''}`}
                aria-hidden
              />
            </button>
          </div>
        }
      />

      {lastComputedAt ? (
        <p className="text-muted-foreground text-caption inline-flex items-center gap-1.5">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden />
          Snapshot terakhir dihitung {new Date(lastComputedAt).toLocaleString('id-ID')}
        </p>
      ) : null}

      {dashboard.isLoading ? <KpiGridSkeleton /> : null}

      {dashboard.data ? (
        <FadeIn>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dashboard.data.tiles.map((tile) => (
              <KpiCard
                key={tile.metricKey}
                tile={tile}
                onSelect={() => setSelectedMetric(tile.metricKey)}
                isSelected={activeMetric === tile.metricKey}
                sparklineData={
                  trend.data && trend.data.metricKey === tile.metricKey
                    ? trend.data.points.map((p) => p.value)
                    : undefined
                }
              />
            ))}
          </div>
        </FadeIn>
      ) : null}

      {dashboard.data ? (
        <FadeIn delay={0.05}>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1">
                  <CardTitle>{trend.data?.label ?? 'Grafik tren'}</CardTitle>
                  <p className="text-muted-foreground text-caption">
                    {trend.data
                      ? `Data harian ${trend.data.window.from} – ${trend.data.window.to} · ${trend.data.window.timezone}`
                      : 'Pilih salah satu tile di atas untuk memuat grafik.'}
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {trend.isLoading ? (
                <Skeleton className="h-[260px] w-full" />
              ) : trend.data ? (
                <TrendChart
                  points={trend.data.points}
                  formatKind={trend.data.formatKind}
                  fractionDigits={trend.data.fractionDigits}
                  ariaLabel={`Grafik ${trend.data.label}`}
                />
              ) : (
                <EmptyChart
                  title="Pilih KPI di atas"
                  description="Klik salah satu tile untuk melihat tren-nya."
                  height={260}
                />
              )}
            </CardContent>
          </Card>
        </FadeIn>
      ) : null}

      {!dashboard.isLoading && !dashboard.data ? (
        <div className="border-destructive/50 bg-destructive/5 text-destructive text-body rounded-lg border p-4">
          Gagal memuat data dashboard. Coba muat ulang halaman atau hubungi admin.
        </div>
      ) : null}
    </div>
  );
}

function KpiGridSkeleton(): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="p-5">
          <Skeleton className="mb-4 h-3 w-24" />
          <Skeleton className="mb-3 h-8 w-32" />
          <Skeleton className="mb-4 h-3 w-full max-w-[200px]" />
          <Skeleton className="h-10 w-full" />
        </Card>
      ))}
    </div>
  );
}
