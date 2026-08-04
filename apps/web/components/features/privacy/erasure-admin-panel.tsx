'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DataErasureAdminRequestRow } from '@workpulse/shared-types';
import { useState } from 'react';

import { ApiError, dataErasureAdminApi } from '@/lib/api-client';

const ERROR_COPY: Record<string, string> = {
  ERASURE_INVALID_TRANSITION: 'Permintaan tidak dalam status yang dapat diputuskan.',
  ERASURE_REJECT_NOTE_REQUIRED: 'Alasan penolakan wajib diisi.',
  ERASURE_ROLE_FORBIDDEN: 'Hanya HR Manager atau Super Admin yang dapat memutuskan.',
  ERASURE_SELF_APPROVAL: 'Anda tidak dapat menyetujui permintaan penghapusan diri sendiri.',
  THROTTLED: 'Terlalu banyak percobaan. Coba lagi sebentar.',
};

const STATUS_COPY: Record<
  DataErasureAdminRequestRow['status'],
  { label: string; tone: 'neutral' | 'progress' | 'warn' | 'ok' | 'error' }
> = {
  PENDING_APPROVAL: { label: 'Menunggu keputusan', tone: 'progress' },
  APPROVED_SCHEDULED: { label: 'Terjadwal eksekusi', tone: 'warn' },
  EXECUTED: { label: 'Sudah dieksekusi', tone: 'ok' },
  REJECTED: { label: 'Ditolak', tone: 'error' },
  CANCELLED: { label: 'Dibatalkan user', tone: 'neutral' },
  FAILED: { label: 'Gagal', tone: 'error' },
};

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
};

export function ErasureAdminPanel(): JSX.Element {
  const [scope, setScope] = useState<'pending' | 'all'>('pending');
  const qc = useQueryClient();
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const rows = useQuery({
    queryKey: ['erasure-admin', scope],
    queryFn: () =>
      scope === 'pending' ? dataErasureAdminApi.listPending() : dataErasureAdminApi.listAll(),
    staleTime: 5_000,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => dataErasureAdminApi.approve(id),
    onSuccess: async () => {
      setInlineError(null);
      await qc.invalidateQueries({ queryKey: ['erasure-admin'] });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setInlineError(ERROR_COPY[err.code] ?? err.message);
      } else {
        setInlineError('Gagal menyetujui permintaan.');
      }
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (input: { id: string; note: string }) =>
      dataErasureAdminApi.reject(input.id, { note: input.note }),
    onSuccess: async () => {
      setInlineError(null);
      setRejectingId(null);
      setRejectNote('');
      await qc.invalidateQueries({ queryKey: ['erasure-admin'] });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setInlineError(ERROR_COPY[err.code] ?? err.message);
      } else {
        setInlineError('Gagal menolak permintaan.');
      }
    },
  });

  const data = rows.data ?? [];

  return (
    <section
      className="space-y-4"
      data-testid="erasure-admin-panel"
      aria-labelledby="erasure-admin-heading"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 id="erasure-admin-heading" className="text-lg font-semibold tracking-tight">
            Permintaan penghapusan data
          </h2>
          <p className="text-muted-foreground text-sm">
            Persetujuan oleh HR Manager atau Super Admin. Eksekusi berjalan otomatis setelah masa
            tenggang.
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Filter permintaan"
          className="border-input inline-flex rounded-md border p-1 text-xs"
        >
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'pending'}
            onClick={() => setScope('pending')}
            data-testid="scope-pending"
            className={`rounded px-2 py-1 ${
              scope === 'pending' ? 'bg-primary text-primary-foreground' : ''
            }`}
          >
            Antrian
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'all'}
            onClick={() => setScope('all')}
            data-testid="scope-all"
            className={`rounded px-2 py-1 ${
              scope === 'all' ? 'bg-primary text-primary-foreground' : ''
            }`}
          >
            Semua
          </button>
        </div>
      </div>

      {inlineError && (
        <p role="alert" className="text-destructive text-xs">
          {inlineError}
        </p>
      )}

      {rows.isLoading ? (
        <p className="text-muted-foreground text-sm">Memuat...</p>
      ) : data.length === 0 ? (
        <p className="border-input text-muted-foreground rounded-md border border-dashed p-4 text-sm">
          {scope === 'pending' ? 'Tidak ada permintaan aktif.' : 'Belum ada permintaan.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {data.map((row) => (
            <li
              key={row.id}
              data-testid="erasure-admin-row"
              data-status={row.status}
              className="border-input rounded-md border p-3 text-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{row.requesterName}</p>
                  <p className="text-muted-foreground text-xs">{row.requesterEmail}</p>
                </div>
                <span className={statusPillClass(STATUS_COPY[row.status].tone)}>
                  {STATUS_COPY[row.status].label}
                </span>
              </div>
              <div className="text-muted-foreground mt-2 space-y-1 text-xs">
                <p>Diajukan {formatDate(row.requestedAt)}</p>
                {row.reason && <p>Alasan user: {row.reason}</p>}
                {row.scheduledFor && <p>Terjadwal eksekusi {formatDate(row.scheduledFor)}</p>}
                {row.executedAt && <p>Dieksekusi {formatDate(row.executedAt)}</p>}
                {row.decisionNote && <p>Catatan keputusan: {row.decisionNote}</p>}
              </div>

              {row.status === 'PENDING_APPROVAL' && (
                <div className="mt-3 space-y-2">
                  {rejectingId === row.id ? (
                    <form
                      className="space-y-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (rejectNote.trim().length === 0) {
                          setInlineError('Alasan penolakan wajib diisi.');
                          return;
                        }
                        rejectMutation.mutate({
                          id: row.id,
                          note: rejectNote.trim(),
                        });
                      }}
                    >
                      <textarea
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value.slice(0, 1000))}
                        data-testid="reject-note"
                        placeholder="Alasan penolakan (wajib)"
                        className="border-input bg-background min-h-[70px] w-full rounded-md border p-2 text-xs"
                      />
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={rejectMutation.isPending}
                          data-testid="reject-confirm"
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50"
                        >
                          {rejectMutation.isPending ? 'Menolak...' : 'Konfirmasi tolak'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRejectingId(null);
                            setRejectNote('');
                          }}
                          className="border-input hover:bg-muted rounded-md border px-3 py-1 text-xs font-medium"
                        >
                          Batal
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => approveMutation.mutate(row.id)}
                        disabled={approveMutation.isPending}
                        data-testid="erasure-approve"
                        className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50"
                      >
                        {approveMutation.isPending ? 'Menyetujui...' : 'Setujui'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejectingId(row.id)}
                        data-testid="erasure-reject"
                        className="border-destructive/40 text-destructive hover:bg-destructive/5 rounded-md border px-3 py-1 text-xs font-medium"
                      >
                        Tolak
                      </button>
                    </div>
                  )}
                </div>
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
