'use client';

import { useQuery } from '@tanstack/react-query';

import { attendanceApi } from '@/lib/api-client';

/**
 * "This month at a glance" card that hangs off the /attendance page.
 *
 * Loads only the *current* UTC month by default — HR view multi-month
 * trends belong to the Reports module, not here. We render four stat
 * tiles + one on-time ratio bar so the employee gets both the raw numbers
 * and a visual sense of the month's discipline in <200ms.
 */
export function MonthlySummaryWidget(): JSX.Element {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  const summary = useQuery({
    queryKey: ['attendance', 'summary', year, month],
    queryFn: () => attendanceApi.monthlySummary({ year, month }),
    // Numbers update as the user clocks in/out during the day — refetch
    // when they come back to the tab so the card feels fresh.
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });

  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <section className="space-y-3 rounded-lg border p-6 shadow-sm">
      <header className="space-y-0.5">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Rekap bulan ini
        </p>
        <p className="text-sm font-medium">{monthLabel}</p>
      </header>

      {summary.isLoading ? (
        <p className="text-sm text-muted-foreground">Memuat...</p>
      ) : summary.isError ? (
        <p className="text-sm text-destructive">Gagal memuat rekap.</p>
      ) : summary.data ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Hadir" value={String(summary.data.presentDays)} suffix="hari" />
            <StatTile
              label="Tepat waktu"
              value={String(summary.data.onTimeDays)}
              suffix="hari"
              tone="ok"
            />
            <StatTile
              label="Terlambat"
              value={String(summary.data.lateDays)}
              suffix={`hari · ${summary.data.totalLateMinutes}m`}
              tone={summary.data.lateDays > 0 ? 'warn' : 'muted'}
            />
            <StatTile
              label="Total jam"
              value={String(summary.data.totalHoursWorked)}
              suffix="jam"
            />
          </div>

          <OnTimeBar percent={summary.data.onTimeRatePercent} />
        </>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------

interface StatTileProps {
  label: string;
  value: string;
  suffix?: string;
  tone?: 'ok' | 'warn' | 'muted';
}

function StatTile({ label, value, suffix, tone = 'muted' }: StatTileProps): JSX.Element {
  const valueClass =
    tone === 'ok'
      ? 'text-emerald-600'
      : tone === 'warn'
        ? 'text-destructive'
        : 'text-foreground';
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold ${valueClass}`}>{value}</p>
      {suffix ? <p className="text-[11px] text-muted-foreground">{suffix}</p> : null}
    </div>
  );
}

function OnTimeBar({ percent }: { percent: number | null }): JSX.Element {
  if (percent === null) {
    return (
      <p className="text-xs text-muted-foreground">
        Belum ada catatan kehadiran bulan ini.
      </p>
    );
  }
  const clamped = Math.max(0, Math.min(100, percent));
  const color =
    clamped >= 90
      ? 'bg-emerald-500'
      : clamped >= 75
        ? 'bg-amber-500'
        : 'bg-destructive';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Tingkat tepat waktu</span>
        <span className="font-medium tabular-nums">{clamped.toFixed(1)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${color}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
