'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarCheck } from 'lucide-react';
import { type JSX } from 'react';

import { CountUp } from '@/components/motion/motion-primitives';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { attendanceApi } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * "This month at a glance" — 4 stat tiles + on-time ratio progress
 * bar. Loads only the current UTC month; HR multi-month trends
 * belong to the Analytics dashboard, not here.
 *
 * Fase 4 rework: replaced hand-rolled `<section>` with `<Card>`, and
 * hard-coded `emerald-600` / `amber-500` / `destructive` colors with
 * semantic tokens (`success`, `warning`, `destructive`). Values now
 * animate via `CountUp` for a subtle "counting up" mount effect.
 */
export function MonthlySummaryWidget(): JSX.Element {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  const summary = useQuery({
    queryKey: ['attendance', 'summary', year, month],
    queryFn: () => attendanceApi.monthlySummary({ year, month }),
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });

  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="bg-primary/10 text-primary rounded-md p-2">
            <CalendarCheck className="h-4 w-4" aria-hidden />
          </div>
          <div className="space-y-0.5">
            <p className="text-muted-foreground text-overline uppercase">Rekap bulan ini</p>
            <CardTitle>{monthLabel}</CardTitle>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {summary.isLoading ? (
          <SummarySkeleton />
        ) : summary.isError ? (
          <p className="text-destructive text-body">Gagal memuat rekap.</p>
        ) : summary.data ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Hadir" value={summary.data.presentDays} suffix="hari" />
              <StatTile
                label="Tepat waktu"
                value={summary.data.onTimeDays}
                suffix="hari"
                tone="success"
              />
              <StatTile
                label="Terlambat"
                value={summary.data.lateDays}
                suffix={`hari · ${summary.data.totalLateMinutes}m`}
                tone={summary.data.lateDays > 0 ? 'warning' : 'muted'}
              />
              <StatTile
                label="Total jam"
                value={summary.data.totalHoursWorked}
                suffix="jam"
                fractionDigits={1}
              />
            </div>

            <OnTimeBar percent={summary.data.onTimeRatePercent} />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

interface StatTileProps {
  label: string;
  value: number;
  suffix?: string;
  tone?: 'success' | 'warning' | 'destructive' | 'muted';
  fractionDigits?: number;
}

function StatTile({
  label,
  value,
  suffix,
  tone = 'muted',
  fractionDigits = 0,
}: StatTileProps): JSX.Element {
  const valueClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'destructive'
          ? 'text-destructive'
          : 'text-foreground';
  return (
    <div className="bg-muted/30 rounded-lg border p-3">
      <p className="text-muted-foreground text-overline uppercase">{label}</p>
      <p className={cn('text-h2 tabular-nums', valueClass)}>
        <CountUp value={value} duration={0.7} format={(n) => n.toFixed(fractionDigits)} />
      </p>
      {suffix ? <p className="text-muted-foreground text-caption">{suffix}</p> : null}
    </div>
  );
}

function OnTimeBar({ percent }: { percent: number | null }): JSX.Element {
  if (percent === null) {
    return (
      <p className="text-muted-foreground text-caption">Belum ada catatan kehadiran bulan ini.</p>
    );
  }
  const clamped = Math.max(0, Math.min(100, percent));
  const barTone = clamped >= 90 ? 'bg-success' : clamped >= 75 ? 'bg-warning' : 'bg-destructive';
  return (
    <div className="space-y-1.5">
      <div className="text-caption flex items-center justify-between">
        <span className="text-muted-foreground">Tingkat tepat waktu</span>
        <span className="text-foreground font-medium tabular-nums">{clamped.toFixed(1)}%</span>
      </div>
      <div
        className="bg-muted h-2 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn('h-full transition-[width] duration-500 ease-out', barTone)}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

function SummarySkeleton(): JSX.Element {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-muted/30 rounded-lg border p-3">
            <Skeleton className="mb-2 h-3 w-16" />
            <Skeleton className="mb-1 h-7 w-12" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="h-2 w-full" />
    </div>
  );
}
