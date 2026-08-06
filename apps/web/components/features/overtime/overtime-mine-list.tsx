'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OvertimeRequest } from '@workpulse/shared-types';
import { AlertTriangle, Ban, Calendar, Inbox } from 'lucide-react';
import { useState, type JSX } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, overtimeApi } from '@/lib/api-client';
import { formatCalendarDate, formatIDR } from '@/lib/format';

import { OvertimeStatusBadge } from './overtime-status-badge';

/**
 * Employee-visible list of own overtime requests, scoped by year.
 *
 * INVARIANT (rules/20 §4): renders `r.totalAmount` and `r.ratePerHour`
 * directly — never `r.ratePerHour * r.hours`. All rate math is
 * server-computed. Cancel is UX-gated to `PENDING_APPROVAL`; the
 * server enforces `ILLEGAL_TRANSITION` if state has moved on.
 */
export function OvertimeMineList(): JSX.Element {
  const qc = useQueryClient();
  const [cancelError, setCancelError] = useState<string | null>(null);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

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

  const years = [currentYear + 1, currentYear, currentYear - 1, currentYear - 2];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Pengajuan lembur saya</CardTitle>
          <p className="text-muted-foreground text-caption">
            Riwayat pengajuan berdasarkan tahun kerja.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="text-muted-foreground h-4 w-4" aria-hidden />
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="text-caption h-8 w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {cancelError ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden />
            <AlertTitle>Tidak dapat dibatalkan</AlertTitle>
            <AlertDescription>{cancelError}</AlertDescription>
          </Alert>
        ) : null}

        {list.isLoading ? (
          <>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </>
        ) : list.error ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden />
            <AlertTitle>Gagal memuat pengajuan lembur</AlertTitle>
            <AlertDescription>Coba muat ulang halaman.</AlertDescription>
          </Alert>
        ) : (list.data ?? []).length === 0 ? (
          <div className="text-muted-foreground border-border flex flex-col items-center gap-2 rounded-lg border border-dashed py-10">
            <Inbox className="h-6 w-6" aria-hidden />
            <p className="text-body text-foreground">Belum ada pengajuan lembur</p>
            <p className="text-caption">Untuk tahun {year}</p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {list.data?.map((r) => {
              const busy = cancel.isPending && cancel.variables === r.id;
              return (
                <li key={r.id}>
                  <Row r={r} busy={busy} onCancel={() => cancel.mutate(r.id)} />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  r,
  busy,
  onCancel,
}: {
  r: OvertimeRequest;
  busy: boolean;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div className="border-border rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body font-semibold">{formatCalendarDate(r.workDate)}</span>
            <Badge variant="muted" className="tabular-nums">
              {r.hours} jam
            </Badge>
            <Badge variant="outline">{r.dayKind}</Badge>
          </div>
          <p className="text-muted-foreground text-caption">
            <span className="font-medium">Alasan:</span> {r.reason}
          </p>
        </div>
        <OvertimeStatusBadge status={r.status} />
      </div>

      <div className="text-caption text-muted-foreground mt-3 grid gap-2 sm:grid-cols-3">
        <div>
          <p className="text-overline uppercase">Tarif / jam</p>
          <p className="text-foreground font-medium tabular-nums">{formatIDR(r.ratePerHour)}</p>
        </div>
        <div>
          <p className="text-overline uppercase">Pengali</p>
          <p className="text-foreground font-medium tabular-nums">×{r.rateMultiplier}</p>
        </div>
        <div>
          <p className="text-overline uppercase">Total</p>
          <p className="text-foreground font-semibold tabular-nums">{formatIDR(r.totalAmount)}</p>
        </div>
      </div>

      {r.decisionNote ? (
        <p className="text-muted-foreground border-border text-caption mt-3 border-l-2 pl-3 italic">
          Catatan approver: {r.decisionNote}
        </p>
      ) : null}

      {r.status === 'PENDING_APPROVAL' ? (
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
            <Ban className="h-3.5 w-3.5" aria-hidden />
            {busy ? 'Membatalkan…' : 'Batalkan'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
