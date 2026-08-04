'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DataExportRequestRow } from '@workpulse/shared-types';
import { useState } from 'react';

import { ApiError, dataExportApi } from '@/lib/api-client';

const ERROR_COPY: Record<string, string> = {
  EXPORT_ALREADY_PENDING:
    'Permintaan ekspor sudah berjalan. Tunggu sampai selesai sebelum mengajukan yang baru.',
  EXPORT_COOLDOWN: 'Permintaan ekspor hanya bisa dilakukan sekali per 24 jam.',
  EXPORT_NOT_READY: 'Arsip masih diproses. Coba lagi sebentar.',
  EXPORT_FAILED: 'Pembuatan arsip sebelumnya gagal. Silakan ajukan ulang.',
  EXPORT_EXPIRED:
    'Arsip sudah kedaluwarsa (batas 24 jam terlewat). Silakan ajukan permintaan baru.',
  THROTTLED: 'Terlalu banyak percobaan. Coba lagi sebentar.',
};

const STATUS_COPY: Record<
  DataExportRequestRow['status'],
  { label: string; tone: 'neutral' | 'progress' | 'ok' | 'error' }
> = {
  PENDING: { label: 'Menunggu antrian', tone: 'progress' },
  PROCESSING: { label: 'Sedang diproses', tone: 'progress' },
  READY: { label: 'Siap diunduh', tone: 'ok' },
  FAILED: { label: 'Gagal', tone: 'error' },
  EXPIRED: { label: 'Kedaluwarsa', tone: 'neutral' },
};

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
};

/**
 * Self-service DSAR panel. The FE contract:
 *
 *   * List requests newest-first; refresh every 5s when any row is
 *     PENDING or PROCESSING so the user sees the READY flip without
 *     manually reloading.
 *   * "Ajukan ekspor" button submits a POST and lets the react-query
 *     invalidation refresh the list.
 *   * "Unduh" button on READY rows calls the download endpoint,
 *     which mints a fresh presigned URL. We `window.location.assign`
 *     that URL — never stash it in state to prevent it from lingering
 *     in devtools history.
 */
export function DataExportPanel(): JSX.Element {
  const qc = useQueryClient();
  const [inlineError, setInlineError] = useState<string | null>(null);

  const requests = useQuery({
    queryKey: ['data-export', 'list'],
    queryFn: () => dataExportApi.list(),
    refetchInterval: (query) => {
      const rows = query.state.data ?? [];
      const inFlight = rows.some((r) => r.status === 'PENDING' || r.status === 'PROCESSING');
      return inFlight ? 5_000 : false;
    },
    staleTime: 5_000,
  });

  const createMutation = useMutation({
    mutationFn: () => dataExportApi.create(),
    onSuccess: async () => {
      setInlineError(null);
      await qc.invalidateQueries({ queryKey: ['data-export', 'list'] });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setInlineError(ERROR_COPY[err.code] ?? err.message);
      } else {
        setInlineError('Tidak dapat mengajukan permintaan ekspor.');
      }
    },
  });

  const downloadMutation = useMutation({
    mutationFn: (id: string) => dataExportApi.downloadUrl(id),
    onSuccess: (res) => {
      setInlineError(null);
      window.location.assign(res.downloadUrl);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setInlineError(ERROR_COPY[err.code] ?? err.message);
      } else {
        setInlineError('Tidak dapat menghasilkan tautan unduh.');
      }
    },
  });

  const rows = requests.data ?? [];
  const hasInFlight = rows.some((r) => r.status === 'PENDING' || r.status === 'PROCESSING');

  return (
    <section
      className="space-y-3"
      data-testid="data-export-panel"
      aria-labelledby="data-export-heading"
    >
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 id="data-export-heading" className="text-lg font-semibold tracking-tight">
            Ekspor data pribadi
          </h2>
          <p className="text-muted-foreground text-sm">
            Unduh salinan seluruh data pribadi Anda dalam satu berkas ZIP berisi file JSON per
            tabel. Batas satu permintaan per 24 jam. Arsip yang siap tersedia selama 24 jam.
          </p>
        </div>
        <button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending || hasInFlight}
          data-testid="data-export-create"
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {createMutation.isPending
            ? 'Mengirim...'
            : hasInFlight
              ? 'Permintaan berjalan'
              : 'Ajukan ekspor data'}
        </button>
      </div>

      {inlineError && (
        <p role="alert" className="text-destructive text-xs">
          {inlineError}
        </p>
      )}

      {requests.isLoading ? (
        <p className="text-muted-foreground text-sm">Memuat riwayat...</p>
      ) : rows.length === 0 ? (
        <p className="border-input text-muted-foreground rounded-md border border-dashed p-4 text-sm">
          Belum ada permintaan ekspor. Klik tombol di atas untuk memulai.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              data-testid="data-export-row"
              data-status={row.status}
              className="border-input flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={statusPillClass(STATUS_COPY[row.status].tone)}>
                    {STATUS_COPY[row.status].label}
                  </span>
                  <p className="text-sm">Diminta {formatDate(row.requestedAt)}</p>
                  {row.fileSize !== null && row.fileSize !== undefined && (
                    <span className="text-muted-foreground text-xs">
                      · {formatSize(row.fileSize)}
                    </span>
                  )}
                </div>
                {row.status === 'READY' && row.expiresAt && (
                  <p className="text-muted-foreground text-xs">
                    Berlaku sampai {formatDate(row.expiresAt)}
                  </p>
                )}
                {row.status === 'FAILED' && row.failureReason && (
                  <p className="text-destructive text-xs">Alasan: {row.failureReason}</p>
                )}
              </div>
              {row.status === 'READY' && (
                <button
                  type="button"
                  onClick={() => downloadMutation.mutate(row.id)}
                  disabled={downloadMutation.isPending}
                  data-testid="data-export-download"
                  className="border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 rounded-md border px-3 py-1 text-xs font-medium disabled:opacity-50"
                >
                  {downloadMutation.isPending ? 'Menyiapkan...' : 'Unduh'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function statusPillClass(tone: 'neutral' | 'progress' | 'ok' | 'error'): string {
  const base = 'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider';
  switch (tone) {
    case 'ok':
      return `${base} bg-emerald-100 text-emerald-900`;
    case 'progress':
      return `${base} bg-amber-100 text-amber-900`;
    case 'error':
      return `${base} bg-destructive/10 text-destructive`;
    case 'neutral':
    default:
      return `${base} bg-muted text-muted-foreground`;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('id-ID', DATE_FORMAT);
  } catch {
    return iso;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
