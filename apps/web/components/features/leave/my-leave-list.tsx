'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ApiError, leaveApi } from '@/lib/api-client';

import { LeaveStatusBadge } from './leave-status-badge';

const ERROR_COPY: Record<string, string> = {
  ILLEGAL_TRANSITION: 'Status permintaan tidak lagi bisa dibatalkan.',
  FORBIDDEN: 'Anda tidak berhak membatalkan permintaan ini.',
};

export function MyLeaveList(): JSX.Element {
  const qc = useQueryClient();
  const [cancelError, setCancelError] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['leave', 'mine'],
    queryFn: () => leaveApi.listMine(),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => leaveApi.cancel(id),
    onSuccess: () => {
      setCancelError(null);
      void qc.invalidateQueries({ queryKey: ['leave'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) setCancelError(ERROR_COPY[err.code] ?? err.message);
      else if (err instanceof Error) setCancelError(err.message);
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Memuat...</p>;

  if (!data || data.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Belum ada pengajuan cuti.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {cancelError && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {cancelError}
        </p>
      )}
      <ul className="divide-y rounded-lg border">
        {data.map((r) => {
          const canCancel = r.status === 'PENDING_SUPERVISOR' || r.status === 'PENDING_HR';
          return (
            <li key={r.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{r.leaveTypeName}</span>
                  <LeaveStatusBadge status={r.status} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {r.startDate} → {r.endDate} · <span className="tabular-nums">{r.days}</span> hari
                </p>
                <p className="text-xs text-muted-foreground">Alasan: {r.reason}</p>
              </div>
              {canCancel && (
                <button
                  type="button"
                  onClick={() => cancel.mutate(r.id)}
                  disabled={cancel.isPending}
                  className="self-start rounded-md border border-input px-3 py-1 text-xs hover:bg-muted disabled:opacity-50"
                >
                  {cancel.isPending && cancel.variables === r.id ? 'Membatalkan...' : 'Batalkan'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
