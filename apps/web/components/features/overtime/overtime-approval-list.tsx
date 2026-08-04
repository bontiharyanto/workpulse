'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ApiError, overtimeApi } from '@/lib/api-client';

const currency = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

const ERROR_COPY: Record<string, string> = {
  ILLEGAL_TRANSITION: 'Status pengajuan sudah berubah. Muat ulang halaman.',
  FORBIDDEN: 'Anda tidak berwenang memutuskan pengajuan ini.',
  OVERTIME_NOT_FOUND: 'Pengajuan tidak ditemukan.',
};

export function OvertimeApprovalList(): JSX.Element {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['overtime', 'approvals'],
    queryFn: () => overtimeApi.listPendingApprovals(),
  });

  const decide = useMutation({
    mutationFn: (args: { id: string; action: 'APPROVE' | 'REJECT'; note?: string }) =>
      overtimeApi.decide(args.id, { action: args.action, note: args.note }),
    onSuccess: () => {
      setError(null);
      setOpenId(null);
      setNote('');
      void qc.invalidateQueries({ queryKey: ['overtime'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(ERROR_COPY[err.code] ?? err.message);
      else setError('Terjadi kesalahan.');
    },
  });

  if (list.isLoading) return <p className="text-sm text-muted-foreground">Memuat…</p>;
  if (list.error) {
    return <p className="text-sm text-destructive">Gagal memuat data.</p>;
  }
  const rows = list.data ?? [];
  if (rows.length === 0) {
    return (
      <p className="rounded-md border p-4 text-sm text-muted-foreground">
        Tidak ada pengajuan lembur yang menunggu keputusan Anda.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <ul className="space-y-2">
        {rows.map((r) => {
          const isOpen = openId === r.id;
          return (
            <li key={r.id} className="rounded-md border p-4 text-sm">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">
                    {r.userFullName ?? r.userId} · {r.workDate} · {r.hours} jam
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.dayKind} · tarif {currency.format(r.ratePerHour)} / jam · total{' '}
                    <span className="font-medium text-foreground">
                      {currency.format(r.totalAmount)}
                    </span>
                  </div>
                </div>
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
                  Menunggu
                </span>
              </header>

              <p className="mt-2">
                <span className="text-muted-foreground">Alasan: </span>
                {r.reason}
              </p>

              {!isOpen ? (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOpenId(r.id);
                      setNote('');
                    }}
                    className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
                  >
                    Putuskan
                  </button>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <label htmlFor={`note-${r.id}`} className="text-xs text-muted-foreground">
                    Catatan (opsional)
                  </label>
                  <textarea
                    id={`note-${r.id}`}
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({ id: r.id, action: 'APPROVE', note: note || undefined })
                      }
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow hover:opacity-90 disabled:opacity-50"
                    >
                      Setujui
                    </button>
                    <button
                      type="button"
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({ id: r.id, action: 'REJECT', note: note || undefined })
                      }
                      className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground shadow hover:opacity-90 disabled:opacity-50"
                    >
                      Tolak
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenId(null);
                        setNote('');
                      }}
                      className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
                    >
                      Batal
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
