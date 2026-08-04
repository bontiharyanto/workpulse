'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type {
  CompanyDashboardSnapshot,
  DepartmentDashboardSnapshot,
} from '@workpulse/shared-types';

import { useAuth } from '@/components/providers/auth-provider';
import { attendanceApi } from '@/lib/api-client';

/**
 * Company-wide attendance snapshot. Renders four scalar cards +
 * a per-department breakdown table. Refreshes every 60s on the
 * assumption that HR keeps this open through the morning.
 *
 * Access control is server-side; the component renders `null` for
 * non-HR / non-Super Admin actors so the shell doesn't leave a gap.
 */
export function CompanyDashboard(): JSX.Element | null {
  const { user } = useAuth();
  const [date, setDate] = useState<string>(() => toIsoDate(new Date()));

  const canView =
    !!user && (user.role === 'HR_MANAGER' || user.role === 'SUPER_ADMIN');

  const q = useQuery({
    queryKey: ['attendance', 'dashboard', date],
    queryFn: () => attendanceApi.dashboard({ date }),
    enabled: canView,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });

  if (!canView) return null;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Tanggal
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
          />
        </label>
        {q.isFetching ? (
          <span className="text-xs text-muted-foreground">Memperbarui…</span>
        ) : null}
      </div>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Memuat rekap...</p>
      ) : q.isError ? (
        <p className="text-sm text-destructive">
          Gagal memuat rekap. Coba muat ulang.
        </p>
      ) : q.data ? (
        <>
          <CompanyCards snapshot={q.data} />
          <DepartmentTable rows={q.data.departments} />
        </>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------

function CompanyCards({
  snapshot,
}: {
  snapshot: CompanyDashboardSnapshot;
}): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard label="Total karyawan" value={snapshot.total} />
      <StatCard label="Sudah clock-in" value={snapshot.clockedIn} tone="ok" />
      <StatCard
        label="Absen"
        value={snapshot.absent}
        tone={snapshot.absent > 0 ? 'warn' : 'muted'}
      />
      <StatCard
        label="Cuti / izin"
        value={snapshot.onLeave}
        tone="muted"
      />
      <StatCard
        label="Belum clock-in"
        value={snapshot.notClockedIn}
        tone={snapshot.notClockedIn > 0 ? 'warn' : 'muted'}
      />
      <StatCard
        label="Terlambat hari ini"
        value={snapshot.lateToday}
        tone={snapshot.lateToday > 0 ? 'warn' : 'muted'}
      />
      <StatCard
        label="Pulang cepat"
        value={snapshot.earlyLeaveToday}
        tone={snapshot.earlyLeaveToday > 0 ? 'warn' : 'muted'}
      />
      <StatCard
        label="On-time"
        value={
          snapshot.onTimeRatePercent === null
            ? '—'
            : `${snapshot.onTimeRatePercent.toFixed(1)}%`
        }
        tone={
          snapshot.onTimeRatePercent === null
            ? 'muted'
            : snapshot.onTimeRatePercent >= 90
              ? 'ok'
              : snapshot.onTimeRatePercent >= 75
                ? 'muted'
                : 'warn'
        }
      />
    </div>
  );
}

function DepartmentTable({
  rows,
}: {
  rows: DepartmentDashboardSnapshot[];
}): JSX.Element {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Tidak ada departemen dengan karyawan aktif.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Departemen</th>
            <th className="px-3 py-2 text-right font-medium">Total</th>
            <th className="px-3 py-2 text-right font-medium">Clock-in</th>
            <th className="px-3 py-2 text-right font-medium">Absen</th>
            <th className="px-3 py-2 text-right font-medium">Cuti</th>
            <th className="px-3 py-2 text-right font-medium">Belum</th>
            <th className="px-3 py-2 text-right font-medium">Terlambat</th>
            <th className="px-3 py-2 text-right font-medium">On-time %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.departmentId ?? '(unassigned)'} className="border-t">
              <td className="px-3 py-2">
                {r.departmentName ?? '(Tanpa departemen)'}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{r.total}</td>
              <td className="px-3 py-2 text-right tabular-nums text-emerald-600">
                {r.clockedIn}
              </td>
              <td
                className={`px-3 py-2 text-right tabular-nums ${
                  r.absent > 0 ? 'text-destructive' : ''
                }`}
              >
                {r.absent}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {r.onLeave}
              </td>
              <td
                className={`px-3 py-2 text-right tabular-nums ${
                  r.notClockedIn > 0 ? 'text-amber-600' : ''
                }`}
              >
                {r.notClockedIn}
              </td>
              <td
                className={`px-3 py-2 text-right tabular-nums ${
                  r.lateToday > 0 ? 'text-amber-600' : ''
                }`}
              >
                {r.lateToday}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {r.onTimeRatePercent === null
                  ? '—'
                  : `${r.onTimeRatePercent.toFixed(1)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: number | string;
  tone?: 'ok' | 'warn' | 'muted';
}

function StatCard({ label, value, tone = 'muted' }: StatCardProps): JSX.Element {
  const valueClass =
    tone === 'ok'
      ? 'text-emerald-600'
      : tone === 'warn'
        ? 'text-destructive'
        : 'text-foreground';
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`text-2xl font-semibold tabular-nums ${valueClass}`}>
        {value}
      </p>
    </div>
  );
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
