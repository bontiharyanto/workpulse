'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/components/providers/auth-provider';
import { ApiError, leaveApi } from '@/lib/api-client';

import { LeaveStatusBadge } from './leave-status-badge';

const ERROR_COPY: Record<string, string> = {
  FORBIDDEN: 'Anda tidak berhak memutuskan permintaan ini.',
  ILLEGAL_TRANSITION: 'Status pengajuan sudah berubah. Muat ulang halaman.',
  LEAVE_REQUEST_NOT_FOUND: 'Pengajuan tidak ditemukan.',
};

export function ApprovalList(): JSX.Element {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [errorText, setErrorText] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const list = useQuery({
    queryKey: ['leave', 'approvals'],
    queryFn: () => leaveApi.listPendingApprovals(),
  });

  const decide = useMutation({
    mutationFn: (v: { id: string; action: 'APPROVE' | 'REJECT'; note?: string }) =>
      leaveApi.decide(v.id, { action: v.action, note: v.note }),
    onSuccess: () => {
      setErrorText(null);
      void qc.invalidateQueries({ queryKey: ['leave'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) setErrorText(ERROR_COPY[err.code] ?? err.message);
      else if (err instanceof Error) setErrorText(err.message);
    },
  });

  if (!user) return <></>;
  if (user.role === 'EMPLOYEE') {
    return (
      <div className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border p-4 text-sm">
        Anda tidak memiliki akses ke halaman ini.
      </div>
    );
  }

  if (list.isLoading) return <p className="text-muted-foreground text-sm">Memuat...</p>;

  if (!list.data || list.data.length === 0) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
        Tidak ada pengajuan menunggu keputusan.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {errorText && (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {errorText}
        </p>
      )}
      <ul className="divide-y rounded-lg border">
        {list.data.map((r) => {
          const busy = decide.isPending && decide.variables?.id === r.id;
          return (
            <li key={r.id} className="space-y-3 p-4">
              <header className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{r.userFullName ?? r.userId}</p>
                  <p className="text-muted-foreground text-xs">
                    {r.leaveTypeName} · {r.startDate} → {r.endDate} ·{' '}
                    <span className="tabular-nums">{r.days}</span> hari
                  </p>
                </div>
                <LeaveStatusBadge status={r.status} />
              </header>

              <p className="text-sm">
                <span className="text-muted-foreground">Alasan: </span>
                {r.reason}
              </p>

              {r.attachmentUrl && (
                <a
                  href={r.attachmentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary text-xs underline-offset-2 hover:underline"
                >
                  Lihat lampiran →
                </a>
              )}

              <textarea
                placeholder="Catatan (opsional)"
                rows={2}
                value={notes[r.id] ?? ''}
                onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              />

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    decide.mutate({ id: r.id, action: 'APPROVE', note: notes[r.id] || undefined })
                  }
                  className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {busy && decide.variables?.action === 'APPROVE' ? 'Menyetujui...' : 'Setujui'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    decide.mutate({ id: r.id, action: 'REJECT', note: notes[r.id] || undefined })
                  }
                  className="border-destructive text-destructive hover:bg-destructive/5 rounded-md border px-3 py-1 text-xs font-medium disabled:opacity-50"
                >
                  {busy && decide.variables?.action === 'REJECT' ? 'Menolak...' : 'Tolak'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
