'use client';

import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';

import type { BacklogItem, ModuleBacklog } from '@workpulse/shared-types';

import { backlogAdminApi } from '@/lib/api-client';

/**
 * Detailed cross-module backlog view. Renders three "module cards", each
 * with a fresh/stale summary, a bucket histogram, and the top-5 oldest
 * PENDING rows for immediate follow-up.
 *
 * The threshold slider (1–14 days) is the only interactive control —
 * every other number is derived. The number lives in URL-less local
 * state on purpose: HR flipping thresholds should not create browser
 * history noise.
 */
export function BacklogDetail(): JSX.Element {
  const [thresholdDays, setThresholdDays] = useState(3);

  const backlog = useQuery({
    queryKey: ['admin', 'approvals', 'backlog', 'detail', thresholdDays],
    queryFn: () => backlogAdminApi.get({ thresholdDays, topN: 10 }),
    staleTime: 30_000,
  });

  return (
    <div className="space-y-6">
      <div className="bg-muted/30 flex flex-wrap items-center gap-3 rounded-md border p-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground text-xs uppercase tracking-wider">
            Ambang batas &quot;stale&quot;
          </span>
          <input
            type="range"
            min={1}
            max={14}
            value={thresholdDays}
            onChange={(e) => setThresholdDays(Number(e.target.value))}
            className="h-1"
          />
          <span className="font-semibold tabular-nums">{thresholdDays} hari</span>
        </label>
        {backlog.data ? (
          <p className="text-muted-foreground ml-auto text-xs">
            Diperbarui {new Date(backlog.data.generatedAt).toLocaleTimeString('id-ID')}
          </p>
        ) : null}
      </div>

      {backlog.isLoading ? (
        <p className="text-muted-foreground text-sm">Memuat backlog...</p>
      ) : backlog.isError || !backlog.data ? (
        <p className="text-destructive text-sm">Gagal memuat backlog.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <ModuleCard
            label="Cuti"
            module={backlog.data.leave}
            staleAfterDays={backlog.data.staleAfterDays}
            queueHref="/leave/approvals"
          />
          <ModuleCard
            label="Lembur"
            module={backlog.data.overtime}
            staleAfterDays={backlog.data.staleAfterDays}
            queueHref="/overtime/approvals"
          />
          <ModuleCard
            label="Koreksi Absensi"
            module={backlog.data.correction}
            staleAfterDays={backlog.data.staleAfterDays}
            queueHref="/attendance/corrections/approvals"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface ModuleCardProps {
  label: string;
  module: ModuleBacklog;
  staleAfterDays: number;
  queueHref: string;
}

function ModuleCard({ label, module, staleAfterDays, queueHref }: ModuleCardProps): JSX.Element {
  return (
    <article className="space-y-4 rounded-lg border p-5 shadow-sm">
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{label}</h2>
        <Link href={queueHref as Route} className="text-primary text-xs underline">
          Buka antrian →
        </Link>
      </header>

      <div className="grid grid-cols-3 gap-2 text-center">
        <SummaryTile label="Total" value={module.total} tone="muted" />
        <SummaryTile label="Fresh" value={module.fresh} tone="ok" />
        <SummaryTile
          label={`Stale (>${staleAfterDays}h)`}
          value={module.stale}
          tone={module.stale > 0 ? 'warn' : 'ok'}
        />
      </div>

      <div>
        <p className="text-muted-foreground mb-1 text-[11px] uppercase tracking-wider">
          Distribusi umur
        </p>
        <div className="grid grid-cols-4 gap-1 text-center text-xs">
          <BucketCell label="0-1h" value={module.buckets.d0_1} tone="ok" />
          <BucketCell label="1-3h" value={module.buckets.d1_3} tone="info" />
          <BucketCell label="3-7h" value={module.buckets.d3_7} tone="warn" />
          <BucketCell
            label="7h+"
            value={module.buckets.d7_plus}
            tone={module.buckets.d7_plus > 0 ? 'danger' : 'muted'}
          />
        </div>
      </div>

      <div>
        <p className="text-muted-foreground mb-2 text-[11px] uppercase tracking-wider">
          Paling lama menunggu
        </p>
        {module.oldest.length === 0 ? (
          <p className="text-muted-foreground text-xs">Tidak ada permintaan menunggu.</p>
        ) : (
          <ul className="space-y-1.5">
            {module.oldest.map((item) => (
              <li key={item.id}>
                <OldestRow item={item} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'ok' | 'warn' | 'muted';
}): JSX.Element {
  const cls =
    tone === 'warn' ? 'text-destructive' : tone === 'ok' ? 'text-emerald-700' : 'text-foreground';
  return (
    <div className="bg-muted/20 rounded-md border p-2">
      <p className="text-muted-foreground text-[10px] uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${cls}`}>{value}</p>
    </div>
  );
}

function BucketCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'ok' | 'info' | 'warn' | 'danger' | 'muted';
}): JSX.Element {
  const bg =
    tone === 'danger'
      ? 'bg-destructive/10 text-destructive'
      : tone === 'warn'
        ? 'bg-amber-100 text-amber-800'
        : tone === 'info'
          ? 'bg-sky-100 text-sky-800'
          : tone === 'ok'
            ? 'bg-emerald-100 text-emerald-800'
            : 'bg-muted text-muted-foreground';
  return (
    <div className={`rounded ${bg} p-1.5`}>
      <p className="text-[10px] uppercase">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function OldestRow({ item }: { item: BacklogItem }): JSX.Element {
  const ageBadgeCls =
    item.ageDays >= 7
      ? 'bg-destructive/10 text-destructive'
      : item.ageDays >= 3
        ? 'bg-amber-100 text-amber-800'
        : 'bg-muted text-muted-foreground';
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span
        className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-medium tabular-nums ${ageBadgeCls}`}
      >
        {item.ageDays}h
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{item.userFullName}</span>{' '}
        <span className="text-muted-foreground">— {item.summary}</span>
      </span>
    </div>
  );
}
