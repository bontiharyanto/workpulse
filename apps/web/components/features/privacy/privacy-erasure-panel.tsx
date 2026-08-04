'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DataErasureRequestRow } from '@workpulse/shared-types';
import { createErasureRequestInputSchema } from '@workpulse/shared-types';
import { useState } from 'react';

import { ApiError, dataErasureApi } from '@/lib/api-client';

const ERROR_COPY: Record<string, string> = {
  ERASURE_ALREADY_PENDING:
    'Anda sudah memiliki permintaan penghapusan yang aktif. Batalkan dulu jika ingin mengajukan yang baru.',
  ERASURE_NOT_CANCELLABLE: 'Permintaan ini tidak dapat dibatalkan pada status saat ini.',
  ERASURE_NOT_FOUND: 'Permintaan tidak ditemukan.',
  THROTTLED: 'Terlalu banyak percobaan. Coba lagi sebentar.',
};

const STATUS_COPY: Record<
  DataErasureRequestRow['status'],
  { label: string; tone: 'neutral' | 'progress' | 'warn' | 'ok' | 'error' }
> = {
  PENDING_APPROVAL: { label: 'Menunggu keputusan HR/Admin', tone: 'progress' },
  APPROVED_SCHEDULED: { label: 'Terjadwal', tone: 'warn' },
  EXECUTED: { label: 'Selesai (data dianonimkan)', tone: 'ok' },
  REJECTED: { label: 'Ditolak', tone: 'error' },
  CANCELLED: { label: 'Dibatalkan', tone: 'neutral' },
  FAILED: { label: 'Gagal', tone: 'error' },
};

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
};

/**
 * Self-service right-to-erasure panel. UX guardrails:
 *
 *   - Two-step confirmation before firing the POST (checkbox + typed
 *     confirmation) because this is destructive and irreversible
 *     after the grace period.
 *   - Panel refetches every 10s when a request is
 *     PENDING_APPROVAL or APPROVED_SCHEDULED, so status flips are
 *     reflected without a manual reload.
 *   - "Batalkan" button on cancellable rows lets the user withdraw
 *     while the grace period is still running.
 */
export function PrivacyErasurePanel(): JSX.Element {
  const qc = useQueryClient();
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const requests = useQuery({
    queryKey: ['data-erasure', 'list'],
    queryFn: () => dataErasureApi.list(),
    refetchInterval: (query) => {
      const rows = query.state.data ?? [];
      const inFlight = rows.some(
        (r) => r.status === 'PENDING_APPROVAL' || r.status === 'APPROVED_SCHEDULED',
      );
      return inFlight ? 10_000 : false;
    },
    staleTime: 5_000,
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const parsed = createErasureRequestInputSchema.parse({ reason });
      return dataErasureApi.create({ reason: parsed.reason });
    },
    onSuccess: async () => {
      setInlineError(null);
      setReason('');
      setAcknowledged(false);
      setConfirmText('');
      await qc.invalidateQueries({ queryKey: ['data-erasure', 'list'] });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setInlineError(ERROR_COPY[err.code] ?? err.message);
      } else {
        setInlineError('Tidak dapat mengajukan permintaan penghapusan.');
      }
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => dataErasureApi.cancel(id),
    onSuccess: async () => {
      setInlineError(null);
      await qc.invalidateQueries({ queryKey: ['data-erasure', 'list'] });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setInlineError(ERROR_COPY[err.code] ?? err.message);
      } else {
        setInlineError('Tidak dapat membatalkan permintaan.');
      }
    },
  });

  const rows = requests.data ?? [];
  const hasInFlight = rows.some(
    (r) => r.status === 'PENDING_APPROVAL' || r.status === 'APPROVED_SCHEDULED',
  );

  const submitDisabled =
    createMutation.isPending ||
    hasInFlight ||
    !acknowledged ||
    confirmText.trim().toUpperCase() !== 'HAPUS';

  return (
    <section
      className="space-y-4"
      data-testid="data-erasure-panel"
      aria-labelledby="data-erasure-heading"
    >
      <div>
        <h2 id="data-erasure-heading" className="text-lg font-semibold tracking-tight">
          Hapus akun & data pribadi
        </h2>
        <p className="text-muted-foreground text-sm">
          Ajukan permintaan penghapusan data pribadi (nama, email, kredensial, notifikasi).
          Permintaan memerlukan persetujuan HR atau Super Admin dan dijalankan setelah masa
          tenggang. Data bisnis (kehadiran, cuti, lembur) tetap disimpan sesuai kewajiban retensi
          hukum.
        </p>
      </div>

      <form
        className="border-input space-y-3 rounded-md border border-dashed p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (submitDisabled) return;
          createMutation.mutate();
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Alasan (opsional, maks 1000 karakter)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 1000))}
            data-testid="erasure-reason"
            className="border-input bg-background min-h-[80px] w-full rounded-md border p-2 text-sm"
            placeholder="Contoh: sudah tidak bekerja di perusahaan ini."
            disabled={hasInFlight}
          />
        </label>

        <label className="text-muted-foreground flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            data-testid="erasure-ack"
            disabled={hasInFlight}
            className="mt-0.5"
          />
          <span>
            Saya memahami bahwa permintaan ini akan menganonimkan data pribadi saya secara permanen
            setelah disetujui dan masa tenggang selesai. Record bisnis (kehadiran, cuti, lembur)
            akan tetap disimpan sebagai bukti sesuai kewajiban retensi.
          </span>
        </label>

        <label className="block text-xs">
          <span className="text-muted-foreground mb-1 block">
            Ketik <strong className="font-mono">HAPUS</strong> untuk konfirmasi.
          </span>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            data-testid="erasure-confirm"
            className="border-input bg-background w-32 rounded-md border px-2 py-1 text-sm"
            disabled={hasInFlight}
          />
        </label>

        <button
          type="submit"
          disabled={submitDisabled}
          data-testid="erasure-submit"
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {createMutation.isPending
            ? 'Mengirim...'
            : hasInFlight
              ? 'Permintaan aktif berjalan'
              : 'Ajukan penghapusan data'}
        </button>
      </form>

      {inlineError && (
        <p role="alert" className="text-destructive text-xs">
          {inlineError}
        </p>
      )}

      {requests.isLoading ? (
        <p className="text-muted-foreground text-sm">Memuat riwayat...</p>
      ) : rows.length === 0 ? (
        <p className="border-input text-muted-foreground rounded-md border border-dashed p-4 text-sm">
          Belum ada permintaan penghapusan.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              data-testid="erasure-row"
              data-status={row.status}
              className="border-input flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={statusPillClass(STATUS_COPY[row.status].tone)}>
                    {STATUS_COPY[row.status].label}
                  </span>
                  <p className="text-sm">Diajukan {formatDate(row.requestedAt)}</p>
                </div>
                {row.reason && (
                  <p className="text-muted-foreground text-xs">Alasan: {row.reason}</p>
                )}
                {row.status === 'APPROVED_SCHEDULED' && row.scheduledFor && (
                  <p className="text-xs text-amber-900">
                    Eksekusi terjadwal {formatDate(row.scheduledFor)}. Anda masih dapat membatalkan
                    sebelum waktu tersebut.
                  </p>
                )}
                {row.status === 'REJECTED' && row.decisionNote && (
                  <p className="text-destructive text-xs">Alasan penolakan: {row.decisionNote}</p>
                )}
                {row.status === 'FAILED' && row.failureReason && (
                  <p className="text-destructive text-xs">Gagal: {row.failureReason}</p>
                )}
              </div>
              {(row.status === 'PENDING_APPROVAL' || row.status === 'APPROVED_SCHEDULED') && (
                <button
                  type="button"
                  onClick={() => cancelMutation.mutate(row.id)}
                  disabled={cancelMutation.isPending}
                  data-testid="erasure-cancel"
                  className="border-input hover:bg-muted rounded-md border px-3 py-1 text-xs font-medium disabled:opacity-50"
                >
                  {cancelMutation.isPending ? 'Membatalkan...' : 'Batalkan'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function statusPillClass(tone: 'neutral' | 'progress' | 'warn' | 'ok' | 'error'): string {
  const base = 'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider';
  switch (tone) {
    case 'ok':
      return `${base} bg-emerald-100 text-emerald-900`;
    case 'warn':
      return `${base} bg-amber-100 text-amber-900`;
    case 'progress':
      return `${base} bg-sky-100 text-sky-900`;
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
