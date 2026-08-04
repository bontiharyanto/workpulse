'use client';

import { useQuery } from '@tanstack/react-query';
import type { ModuleBacklog } from '@workpulse/shared-types';
import type { Route } from 'next';
import Link from 'next/link';

import { backlogAdminApi } from '@/lib/api-client';

/**
 * Compact "approvals backlog" tile for the HR company dashboard.
 *
 * Shows the stale-across-all-modules total prominently, with per-module
 * chips underneath. Clicking any chip navigates to that module's own
 * approvals page for immediate action; the top-level tile also links to
 * a detailed cross-module drill-down.
 *
 * Kept intentionally small (no charts): the point is to make backlog
 * visible at a glance without pulling attention away from the primary
 * daily attendance stats.
 */
export function BacklogTile(): JSX.Element | null {
  const backlog = useQuery({
    queryKey: ['admin', 'approvals', 'backlog'],
    queryFn: () => backlogAdminApi.get(),
    // Refetch when the tab regains focus — HR often flips between this
    // and the module-specific pages while working through the queue.
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });

  if (backlog.isLoading) {
    return (
      <section className="rounded-lg border p-6 shadow-sm">
        <p className="text-muted-foreground text-sm">Memuat backlog...</p>
      </section>
    );
  }
  if (backlog.isError || !backlog.data) {
    return null; // Non-fatal: dashboard still usable without this tile.
  }
  const { leave, overtime, correction, staleAfterDays } = backlog.data;
  const totalPending = leave.total + overtime.total + correction.total;
  const totalStale = leave.stale + overtime.stale + correction.stale;

  if (totalPending === 0) {
    return (
      <section className="rounded-lg border bg-emerald-50 p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-emerald-800">
              Backlog persetujuan
            </p>
            <p className="text-sm font-medium text-emerald-900">
              Tidak ada permintaan menunggu keputusan.
            </p>
          </div>
          <Link href="/admin/approvals-backlog" className="text-xs text-emerald-800 underline">
            Detail →
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border p-6 shadow-sm">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-widest">
            Backlog persetujuan
          </p>
          <p className="text-2xl font-semibold">
            {totalPending}
            <span className="text-muted-foreground ml-2 text-sm font-normal">
              menunggu ·{' '}
              {totalStale > 0 ? (
                <span className="text-destructive font-semibold">
                  {totalStale} sudah &gt; {staleAfterDays} hari
                </span>
              ) : (
                <span className="text-emerald-700">semua fresh</span>
              )}
            </span>
          </p>
        </div>
        <Link
          href="/admin/approvals-backlog"
          className="border-input hover:bg-muted whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-medium"
        >
          Detail →
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ModuleChip
          label="Cuti"
          module={leave}
          staleAfterDays={staleAfterDays}
          href="/leave/approvals"
        />
        <ModuleChip
          label="Lembur"
          module={overtime}
          staleAfterDays={staleAfterDays}
          href="/overtime/approvals"
        />
        <ModuleChip
          label="Koreksi Absensi"
          module={correction}
          staleAfterDays={staleAfterDays}
          href="/attendance/corrections/approvals"
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

interface ModuleChipProps {
  label: string;
  module: ModuleBacklog;
  staleAfterDays: number;
  href: string;
}

function ModuleChip({ label, module, staleAfterDays, href }: ModuleChipProps): JSX.Element {
  const tone = module.stale > 0 ? 'warn' : module.total > 0 ? 'info' : 'muted';
  const border =
    tone === 'warn'
      ? 'border-destructive/30 bg-destructive/5'
      : tone === 'info'
        ? 'border-primary/30 bg-primary/5'
        : 'border-muted-foreground/10';

  return (
    <Link
      href={href as Route}
      className={`block rounded-md border ${border} p-3 transition hover:opacity-80`}
    >
      <p className="text-muted-foreground text-[11px] uppercase tracking-wider">{label}</p>
      <p className="text-lg font-semibold tabular-nums">
        {module.total}
        <span className="text-muted-foreground ml-1 text-xs font-normal">menunggu</span>
      </p>
      <p className="text-xs">
        {module.stale > 0 ? (
          <span className="text-destructive">
            {module.stale} &gt; {staleAfterDays}h
          </span>
        ) : (
          <span className="text-muted-foreground">semua fresh</span>
        )}
      </p>
    </Link>
  );
}
