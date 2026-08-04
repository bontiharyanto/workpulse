'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Paperclip,
  ShieldOff,
  User2,
  XCircle,
} from 'lucide-react';
import { useState, type JSX } from 'react';

import { useAuth } from '@/components/providers/auth-provider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, leaveApi } from '@/lib/api-client';
import { formatCalendarDate } from '@/lib/format';

import { LeaveStatusBadge } from './leave-status-badge';

/**
 * Approver queue for leave requests.
 *
 * INVARIANTS (rules/20 §3): visibility gate here is a UX
 * affordance; the server-side `RolesGuard` on `/leave/approvals/pending`
 * and `/leave/{id}/decision` is the real authorization. The two-level
 * state machine (`PENDING_SUPERVISOR → PENDING_HR → APPROVED`) is
 * enforced by the API. We surface `ILLEGAL_TRANSITION` inline.
 */
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
    enabled: !!user && user.role !== 'EMPLOYEE',
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
      <Alert variant="destructive">
        <ShieldOff aria-hidden />
        <AlertTitle>Akses ditolak</AlertTitle>
        <AlertDescription>Halaman ini hanya untuk supervisor dan HR.</AlertDescription>
      </Alert>
    );
  }

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

  if (!list.data || list.data.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-12">
          <Inbox className="h-8 w-8" aria-hidden />
          <p className="text-h6 text-foreground">Antrian kosong</p>
          <p className="text-caption">Tidak ada pengajuan menunggu keputusan Anda.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {errorText ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>Keputusan tidak dapat disimpan</AlertTitle>
          <AlertDescription>{errorText}</AlertDescription>
        </Alert>
      ) : null}

      {list.data.map((r) => {
        const busy = decide.isPending && decide.variables?.id === r.id;
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
                      <Badge variant="muted" className="mr-1.5">
                        {r.leaveTypeName}
                      </Badge>
                      {formatCalendarDate(r.startDate)} — {formatCalendarDate(r.endDate)} ·{' '}
                      <span className="tabular-nums">{r.days}</span> hari
                    </p>
                  </div>
                </div>
                <LeaveStatusBadge status={r.status} />
              </div>

              <div className="bg-muted/30 border-border rounded-md border p-3">
                <p className="text-muted-foreground text-overline mb-1 uppercase">Alasan</p>
                <p className="text-body">{r.reason}</p>
              </div>

              {r.attachmentUrl ? (
                <a
                  href={r.attachmentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary text-caption inline-flex items-center gap-1 hover:underline"
                >
                  <Paperclip className="h-3.5 w-3.5" aria-hidden />
                  Lihat lampiran
                </a>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor={`leave-approval-note-${r.id}`}>
                  Catatan keputusan <Badge variant="muted">opsional</Badge>
                </Label>
                <Textarea
                  id={`leave-approval-note-${r.id}`}
                  placeholder="Ditampilkan ke pengaju jika ditolak."
                  rows={2}
                  value={notes[r.id] ?? ''}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="success"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    decide.mutate({ id: r.id, action: 'APPROVE', note: notes[r.id] || undefined })
                  }
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  {busy && decide.variables?.action === 'APPROVE' ? 'Menyetujui…' : 'Setujui'}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    decide.mutate({ id: r.id, action: 'REJECT', note: notes[r.id] || undefined })
                  }
                >
                  <XCircle className="h-4 w-4" aria-hidden />
                  {busy && decide.variables?.action === 'REJECT' ? 'Menolak…' : 'Tolak'}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
