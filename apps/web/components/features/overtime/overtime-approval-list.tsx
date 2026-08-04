'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Inbox,
  User2,
  XCircle,
} from 'lucide-react';
import { useState, type JSX } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, overtimeApi } from '@/lib/api-client';
import { formatCalendarDate, formatIDR } from '@/lib/format';

import { OvertimeStatusBadge } from './overtime-status-badge';

/**
 * Approver queue for overtime requests.
 *
 * INVARIANT (rules/20 §4): renders server-computed
 * `ratePerHour × rateMultiplier` + `totalAmount` directly, never
 * client-derived. Individual notes are kept in a `Record<id, string>`
 * so switching between rows doesn't lose in-flight drafts.
 */
const ERROR_COPY: Record<string, string> = {
  ILLEGAL_TRANSITION: 'Status pengajuan sudah berubah. Muat ulang halaman.',
  FORBIDDEN: 'Anda tidak berwenang memutuskan pengajuan ini.',
  OVERTIME_NOT_FOUND: 'Pengajuan tidak ditemukan.',
};

export function OvertimeApprovalList(): JSX.Element {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['overtime', 'approvals'],
    queryFn: () => overtimeApi.listPendingApprovals(),
  });

  const decide = useMutation({
    mutationFn: (args: { id: string; action: 'APPROVE' | 'REJECT'; note?: string }) =>
      overtimeApi.decide(args.id, { action: args.action, note: args.note }),
    onSuccess: (_, vars) => {
      setError(null);
      setOpenId(null);
      setNotes((prev) => {
        const next = { ...prev };
        delete next[vars.id];
        return next;
      });
      void qc.invalidateQueries({ queryKey: ['overtime'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(ERROR_COPY[err.code] ?? err.message);
      else setError('Terjadi kesalahan.');
    },
  });

  if (list.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-3 p-6">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (list.error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle aria-hidden />
        <AlertTitle>Gagal memuat data</AlertTitle>
        <AlertDescription>Coba muat ulang halaman.</AlertDescription>
      </Alert>
    );
  }

  const rows = list.data ?? [];

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-12">
          <Inbox className="h-8 w-8" aria-hidden />
          <p className="text-h6 text-foreground">Antrian kosong</p>
          <p className="text-caption">Tidak ada pengajuan lembur menunggu keputusan Anda.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>Keputusan tidak dapat disimpan</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {rows.map((r) => {
        const isOpen = openId === r.id;
        const busy = decide.isPending && decide.variables?.id === r.id;
        const rowNote = notes[r.id] ?? '';
        return (
          <Card key={r.id}>
            <CardContent className="space-y-4 p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="bg-muted text-muted-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                    <User2 className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="space-y-1">
                    <p className="text-body font-semibold">{r.userFullName ?? r.userId}</p>
                    <p className="text-muted-foreground text-caption">
                      {formatCalendarDate(r.workDate)} ·{' '}
                      <span className="tabular-nums">{r.hours}</span> jam
                      <Badge variant="outline" className="ml-2">
                        {r.dayKind}
                      </Badge>
                    </p>
                  </div>
                </div>
                <OvertimeStatusBadge status={r.status} />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <MetricCell label="Tarif / jam" value={formatIDR(r.ratePerHour)} />
                <MetricCell label="Pengali" value={`×${r.rateMultiplier}`} />
                <MetricCell label="Total" value={formatIDR(r.totalAmount)} strong />
              </div>

              <div className="bg-muted/30 border-border rounded-md border p-3">
                <p className="text-muted-foreground text-overline mb-1 uppercase">Alasan</p>
                <p className="text-body">{r.reason}</p>
              </div>

              {!isOpen ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setOpenId(r.id);
                  }}
                >
                  <ChevronDown className="h-4 w-4" aria-hidden />
                  Putuskan
                </Button>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={`overtime-approval-note-${r.id}`}>
                      Catatan keputusan <Badge variant="muted">opsional</Badge>
                    </Label>
                    <Textarea
                      id={`overtime-approval-note-${r.id}`}
                      rows={2}
                      value={rowNote}
                      onChange={(e) =>
                        setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))
                      }
                      placeholder="Ditampilkan ke pengaju jika ditolak."
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="success"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        decide.mutate({
                          id: r.id,
                          action: 'APPROVE',
                          note: rowNote || undefined,
                        })
                      }
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden />
                      {busy && decide.variables?.action === 'APPROVE'
                        ? 'Menyetujui…'
                        : 'Setujui'}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        decide.mutate({
                          id: r.id,
                          action: 'REJECT',
                          note: rowNote || undefined,
                        })
                      }
                    >
                      <XCircle className="h-4 w-4" aria-hidden />
                      {busy && decide.variables?.action === 'REJECT' ? 'Menolak…' : 'Tolak'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpenId(null)}
                      disabled={busy}
                    >
                      <ChevronUp className="h-4 w-4" aria-hidden />
                      Tutup
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function MetricCell({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}): JSX.Element {
  return (
    <div className="text-caption">
      <p className="text-muted-foreground text-overline uppercase">{label}</p>
      <p
        className={
          strong
            ? 'text-foreground tabular-nums text-h6 font-semibold'
            : 'text-foreground tabular-nums font-medium'
        }
      >
        {value}
      </p>
    </div>
  );
}
