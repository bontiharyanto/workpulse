'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';

import { ApiError, ropaAdminApi, saveBlob } from '@/lib/api-client';

const ERROR_COPY: Record<string, string> = {
  ROPA_SLUG_TAKEN: 'Slug ini sudah dipakai di tenant Anda.',
  ROPA_SLUG_INVALID: 'Slug hanya boleh huruf kecil, angka, dan tanda hubung (2..64 karakter).',
  THROTTLED: 'Terlalu banyak percobaan. Coba lagi sebentar.',
};

const STATUS_BADGE: Record<
  'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED',
  { label: string; className: string }
> = {
  DRAFT: {
    label: 'Draft',
    className: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
  },
  REVIEW: {
    label: 'Review',
    className: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100',
  },
  PUBLISHED: {
    label: 'Published',
    className: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
  },
  ARCHIVED: {
    label: 'Archived',
    className: 'bg-muted text-muted-foreground',
  },
};

/**
 * Fase 31d — main ROPA registry panel.
 *
 * Surfaces the "seed defaults" + "export PDF/XLSX" operations plus a
 * scannable list of every processing activity. Each row is a link into
 * the detail page which handles edit / submit-review / publish.
 */
export function RopaRegistryPanel(): JSX.Element {
  const qc = useQueryClient();
  const [banner, setBanner] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['ropa-activities'],
    queryFn: () => ropaAdminApi.list(),
    staleTime: 10_000,
  });

  const seed = useMutation({
    mutationFn: () => ropaAdminApi.seedDefaults(),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['ropa-activities'] });
      setBanner(
        `Seed selesai: ${res.created.length} versi dibuat, ${res.skipped.length} sudah ada.`,
      );
    },
  });

  const exportPdf = useMutation({
    mutationFn: () => ropaAdminApi.exportPdf(),
    onSuccess: (result) => saveBlob(result),
  });

  const exportXlsx = useMutation({
    mutationFn: () => ropaAdminApi.exportXlsx(),
    onSuccess: (result) => saveBlob(result),
  });

  const seedError = seed.error
    ? seed.error instanceof ApiError
      ? (ERROR_COPY[seed.error.code] ?? seed.error.message)
      : 'Gagal menjalankan seed.'
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Register aktivitas pemrosesan</h2>
          <p className="text-muted-foreground text-sm">
            Setiap aktivitas memiliki riwayat versi terpisah (DRAFT → REVIEW → PUBLISHED). Regulator
            hanya membaca versi PUBLISHED.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => seed.mutate()}
            disabled={seed.isPending}
            className="border-border bg-background hover:bg-muted inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            {seed.isPending ? 'Menjalankan…' : 'Seed defaults'}
          </button>
          <button
            type="button"
            onClick={() => exportPdf.mutate()}
            disabled={exportPdf.isPending}
            className="border-border bg-background hover:bg-muted inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exportPdf.isPending ? 'Menyiapkan…' : 'Export PDF'}
          </button>
          <button
            type="button"
            onClick={() => exportXlsx.mutate()}
            disabled={exportXlsx.isPending}
            className="border-border bg-background hover:bg-muted inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exportXlsx.isPending ? 'Menyiapkan…' : 'Export XLSX'}
          </button>
        </div>
      </div>

      {banner && (
        <div
          role="status"
          className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200"
        >
          {banner}
        </div>
      )}
      {seedError && (
        <div
          role="alert"
          className="border-destructive/50 bg-destructive/5 text-destructive rounded-md border p-3 text-sm"
        >
          {seedError}
        </div>
      )}

      {list.isLoading ? (
        <div
          role="status"
          aria-live="polite"
          className="border-border text-muted-foreground rounded-md border border-dashed p-6 text-sm"
        >
          Memuat daftar aktivitas…
        </div>
      ) : list.data && list.data.length > 0 ? (
        <ul className="space-y-3">
          {list.data.map((item) => {
            const shown = item.currentVersion ?? item.reviewVersion ?? item.draftVersion;
            if (!shown) return null;
            const badge = STATUS_BADGE[shown.status];
            return (
              <li key={item.activityId} className="border-border bg-card rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-medium">
                      {shown.name}{' '}
                      <span className={`ml-2 rounded px-2 py-0.5 text-xs ${badge.className}`}>
                        {badge.label}
                      </span>
                    </p>
                    <p className="text-muted-foreground text-xs">
                      slug: {item.slug} · versi terbaru: {shown.version}
                      {item.currentVersion && item.draftVersion
                        ? ' · draft baru sedang disiapkan'
                        : ''}
                      {item.currentVersion && item.reviewVersion ? ' · draft menunggu review' : ''}
                    </p>
                    <p className="text-muted-foreground line-clamp-2 text-sm">{shown.purpose}</p>
                  </div>
                  <Link
                    href={`/admin/ropa/${item.activityId}` as Route}
                    className="border-border hover:bg-muted inline-flex shrink-0 items-center rounded-md border px-3 py-1.5 text-xs font-medium"
                  >
                    Kelola →
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="border-border text-muted-foreground rounded-md border border-dashed p-6 text-sm">
          Belum ada aktivitas terdaftar. Klik &ldquo;Seed defaults&rdquo; untuk mengimpor enam
          aktivitas bawaan (kehadiran, cuti, lembur, timesheet / payroll, autentikasi, webhook),
          lalu review masing-masing sebelum publish.
        </div>
      )}
    </div>
  );
}
