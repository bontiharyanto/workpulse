'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { attendanceApi } from '@/lib/api-client';

/**
 * Employee-facing attendance history. Ranged filter: default 30 days back,
 * user can pick a preset (30/60/90) or open the year+month picker.
 *
 * Server bounds the max range to 365 days and clamps `limit` to 200 — this
 * component only offers 30/60/90 to keep the UI simple; a "year view" is
 * follow-up work.
 */

type RangePreset = '30' | '60' | '90';

export function AttendanceHistory(): JSX.Element {
  const [preset, setPreset] = useState<RangePreset>('30');

  const { from, to } = useMemo(() => rangeFor(preset), [preset]);

  const list = useQuery({
    queryKey: ['attendance', 'history', from, to],
    queryFn: () => attendanceApi.history({ from, to, limit: 200 }),
    staleTime: 30_000,
  });

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Riwayat kehadiran</h2>
          <p className="text-muted-foreground text-xs">
            {from} → {to}
          </p>
        </div>
        <div className="bg-background flex gap-1 rounded-md border p-0.5 text-xs">
          {(['30', '60', '90'] as RangePreset[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={`rounded px-2.5 py-1 ${
                preset === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
              }`}
            >
              {p}h
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground text-left text-xs uppercase tracking-wider">
            <tr>
              <th className="px-3 py-2">Tanggal</th>
              <th className="px-3 py-2">Clock-in</th>
              <th className="px-3 py-2">Clock-out</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Telat</th>
              <th className="px-3 py-2 text-right">Cepat</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading ? (
              <tr>
                <td colSpan={6} className="text-muted-foreground px-3 py-6 text-center text-sm">
                  Memuat...
                </td>
              </tr>
            ) : list.data && list.data.length > 0 ? (
              list.data.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 tabular-nums">{formatDate(r.workDate)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatTime(r.clockInAt)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {r.clockOutAt ? formatTime(r.clockOutAt) : <MutedDash />}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.lateMinutes > 0 ? (
                      <span className="text-destructive">{r.lateMinutes}m</span>
                    ) : (
                      <MutedDash />
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.earlyLeaveMinutes > 0 ? (
                      <span className="text-amber-700">{r.earlyLeaveMinutes}m</span>
                    ) : (
                      <MutedDash />
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="text-muted-foreground px-3 py-6 text-center text-sm">
                  Tidak ada catatan kehadiran pada rentang ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rangeFor(preset: RangePreset): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - Number(preset) + 1);
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MutedDash(): JSX.Element {
  return <span className="text-muted-foreground">—</span>;
}

function StatusPill({ status }: { status: string }): JSX.Element {
  const { label, className } = statusStyle(status);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}
    >
      {label}
    </span>
  );
}

function statusStyle(status: string): { label: string; className: string } {
  switch (status) {
    case 'ON_TIME':
      return { label: 'Tepat waktu', className: 'bg-emerald-100 text-emerald-800' };
    case 'LATE':
      return { label: 'Terlambat', className: 'bg-destructive/10 text-destructive' };
    case 'EARLY_LEAVE':
      return { label: 'Pulang cepat', className: 'bg-amber-100 text-amber-800' };
    case 'ON_LEAVE':
      return { label: 'Cuti', className: 'bg-sky-100 text-sky-800' };
    case 'ABSENT':
      return { label: 'Absen', className: 'bg-muted text-muted-foreground' };
    default:
      return { label: status, className: 'bg-muted text-muted-foreground' };
  }
}
