'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OvertimeRequest, OvertimeStatus } from '@workpulse/shared-types';
import { useState } from 'react';

import { ApiError, overtimeApi } from '@/lib/api-client';

const STATUS_LABEL: Record<OvertimeStatus, string> = {
  PENDING_APPROVAL: 'Menunggu Approval',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  COMPLETED: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

const STATUS_BADGE: Record<OvertimeStatus, string> = {
  PENDING_APPROVAL: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  APPROVED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  REJECTED: 'bg-destructive/10 text-destructive',
  COMPLETED: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  CANCELLED: 'bg-muted text-muted-foreground',
};

const currency = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

export function OvertimeMineList(): JSX.Element {
  const qc = useQueryClient();
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());

  const list = useQuery({
    queryKey: ['overtime', 'mine', year],
    queryFn: () => overtimeApi.listMine(year),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => overtimeApi.cancel(id),
    onSuccess: () => {
      setCancelError(null);
      void qc.invalidateQueries({ queryKey: ['overtime'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) setCancelError(err.message);
      else setCancelError('Gagal membatalkan.');
    },
  });

  if (list.isLoading) return <p className="text-sm text-muted-foreground">Memuat…</p>;
  if (list.error) {
    return (
      <p className="text-sm text-destructive">
        Gagal memuat pengajuan lembur.
      </p>
    );
  }
  const rows = list.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <label htmlFor="ot-year" className="text-muted-foreground">
          Tahun:
        </label>
        <select
          id="ot-year"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-md border border-input bg-background px-2 py-1"
        >
          {[year + 1, year, year - 1, year - 2].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {cancelError && (
        <p role="alert" className="text-xs text-destructive">
          {cancelError}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada pengajuan lembur untuk tahun {year}.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <Row
              key={r.id}
              r={r}
              onCancel={() => cancel.mutate(r.id)}
              cancelPending={cancel.isPending}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({
  r,
  onCancel,
  cancelPending,
}: {
  r: OvertimeRequest;
  onCancel: () => void;
  cancelPending: boolean;
}): JSX.Element {
  return (
    <li className="rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">
          {r.workDate} · {r.hours} jam
          <span className="ml-2 text-xs text-muted-foreground">({r.dayKind})</span>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[r.status]}`}>
          {STATUS_LABEL[r.status]}
        </span>
      </div>
      <p className="mt-1 text-muted-foreground">Alasan: {r.reason}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Tarif: {currency.format(r.ratePerHour)} / jam (×{r.rateMultiplier}) · Total{' '}
        <span className="font-medium text-foreground">{currency.format(r.totalAmount)}</span>
      </p>
      {r.decisionNote && (
        <p className="mt-1 text-xs italic text-muted-foreground">
          Catatan approver: {r.decisionNote}
        </p>
      )}
      {r.status === 'PENDING_APPROVAL' && (
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelPending}
          className="mt-2 text-xs text-destructive underline-offset-2 hover:underline disabled:opacity-50"
        >
          Batalkan
        </button>
      )}
    </li>
  );
}
