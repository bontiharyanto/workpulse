'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, Inbox } from 'lucide-react';
import { useState, type JSX } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, leaveApi } from '@/lib/api-client';
import { formatCalendarDate } from '@/lib/format';

import { LeaveStatusBadge } from './leave-status-badge';

const ERROR_COPY: Record<string, string> = {
  ILLEGAL_TRANSITION: 'Status permintaan sudah berubah. Muat ulang halaman.',
  FORBIDDEN: 'Anda tidak berhak membatalkan permintaan ini.',
};

/**
 * Employee-visible list of own leave requests. Cancel is available
 * only for `PENDING_SUPERVISOR` / `PENDING_HR` — a UX affordance
 * that mirrors the server-side state machine. The server still
 * returns `ILLEGAL_TRANSITION` if state has moved on; we surface
 * that copy inline.
 */
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Riwayat pengajuan Anda</CardTitle>
        <p className="text-muted-foreground text-caption">
          Semua pengajuan cuti yang Anda buat, terbaru di atas.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {cancelError ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden />
            <AlertTitle>Tidak dapat dibatalkan</AlertTitle>
            <AlertDescription>{cancelError}</AlertDescription>
          </Alert>
        ) : null}

        {isLoading ? (
          <>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </>
        ) : !data || data.length === 0 ? (
          <div className="border-border text-muted-foreground rounded-lg border border-dashed p-8 text-center">
            <Inbox className="mx-auto mb-2 h-6 w-6" aria-hidden />
            <p className="text-body">Belum ada pengajuan cuti.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {data.map((r) => {
              const canCancel = r.status === 'PENDING_SUPERVISOR' || r.status === 'PENDING_HR';
              const isCurrentCancel = cancel.isPending && cancel.variables === r.id;
              return (
                <li
                  key={r.id}
                  className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-body font-medium">{r.leaveTypeName}</span>
                      <LeaveStatusBadge status={r.status} />
                    </div>
                    <p className="text-muted-foreground text-caption">
                      {formatCalendarDate(r.startDate)} — {formatCalendarDate(r.endDate)} ·{' '}
                      <span className="tabular-nums">{r.days}</span> hari
                    </p>
                    <p className="text-muted-foreground text-caption">
                      <span className="font-medium">Alasan:</span> {r.reason}
                    </p>
                  </div>
                  {canCancel ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="self-start"
                      onClick={() => cancel.mutate(r.id)}
                      disabled={cancel.isPending}
                    >
                      <Ban className="h-3.5 w-3.5" aria-hidden />
                      {isCurrentCancel ? 'Membatalkan…' : 'Batalkan'}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
