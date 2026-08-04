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

  if (isLoading) return <p className="text-muted-foreground text-sm">Memuat...</p>;

  if (!data || data.length === 0) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
        Belum ada pengajuan cuti.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {cancelError && (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {cancelError}
        </p>
      )}
      <ul className="divide-y rounded-lg border">
        {data.map((r) => {
          const canCancel = r.status === 'PENDING_SUPERVISOR' || r.status === 'PENDING_HR';
          return (
            <li
              key={r.id}
              className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{r.leaveTypeName}</span>
                  <LeaveStatusBadge status={r.status} />
                </div>
                <p className="text-muted-foreground text-sm">
                  {r.startDate} → {r.endDate} · <span className="tabular-nums">{r.days}</span> hari
                </p>
                <p className="text-muted-foreground text-xs">Alasan: {r.reason}</p>
              </div>
              {canCancel && (
                <button
                  type="button"
                  onClick={() => cancel.mutate(r.id)}
                  disabled={cancel.isPending}
                  className="border-input hover:bg-muted self-start rounded-md border px-3 py-1 text-xs disabled:opacity-50"
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
