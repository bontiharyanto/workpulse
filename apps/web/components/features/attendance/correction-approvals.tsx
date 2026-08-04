'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AttendanceCorrection } from '@workpulse/shared-types';
import { AlertTriangle, CheckCircle2, Inbox, Paperclip, User2, XCircle } from 'lucide-react';
import { useState, type JSX } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, attendanceCorrectionsApi } from '@/lib/api-client';

/**
 * Approver queue — pending corrections. Server scopes the list to:
 *   - SUPERVISOR: only the caller's direct reports.
 *   - HR_MANAGER / SUPER_ADMIN: the entire tenant.
 *
 * Fase 4 rework: each row renders as a `<Card>` with a persistent
 * decision form (previously required an inline expansion). The
 * Approve / Reject buttons are semantic (`success` / `destructive`)
 * and the optional note is a proper Textarea + Label pair.
 */
export function CorrectionApprovals(): JSX.Element {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['attendance', 'corrections', 'pending'],
    queryFn: attendanceCorrectionsApi.listPendingApprovals,
    staleTime: 15_000,
  });

  const decide = useMutation({
    mutationFn: (input: { id: string; action: 'APPROVE' | 'REJECT'; note?: string }) =>
      attendanceCorrectionsApi.decide(input.id, {
        action: input.action,
        note: input.note,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance', 'corrections', 'pending'] });
    },
  });

  if (list.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-3 p-6">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (list.isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle aria-hidden />
        <AlertTitle>Gagal memuat daftar</AlertTitle>
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
          <p className="text-caption">Tidak ada koreksi yang menunggu keputusan Anda.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <ApprovalRow
          key={r.id}
          row={r}
          onDecide={(action, note) => decide.mutate({ id: r.id, action, note: note || undefined })}
          submitting={decide.isPending}
        />
      ))}
      {decide.isError ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>Keputusan tidak dapat disimpan</AlertTitle>
          <AlertDescription>{formatApiError(decide.error)}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface ApprovalRowProps {
  row: AttendanceCorrection;
  onDecide: (action: 'APPROVE' | 'REJECT', note: string) => void;
  submitting: boolean;
}

function ApprovalRow({ row, onDecide, submitting }: ApprovalRowProps): JSX.Element {
  const [note, setNote] = useState('');
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="bg-muted text-muted-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
              <User2 className="h-5 w-5" aria-hidden />
            </div>
            <div className="space-y-1">
              <p className="text-body font-semibold">{row.userFullName ?? row.userId}</p>
              <p className="text-muted-foreground text-caption">
                {formatDate(row.workDate)} · {summarize(row)}
              </p>
            </div>
          </div>
          {row.attachmentUrl ? (
            <a
              href={row.attachmentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary text-caption inline-flex items-center gap-1 hover:underline"
            >
              <Paperclip className="h-3.5 w-3.5" aria-hidden />
              Lampiran
            </a>
          ) : null}
        </div>

        <div className="bg-muted/30 border-border rounded-md border p-3">
          <p className="text-muted-foreground text-overline mb-1 uppercase">Alasan</p>
          <p className="text-body">{row.reason}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`approval-note-${row.id}`}>
            Catatan keputusan <Badge variant="muted">opsional</Badge>
          </Label>
          <Textarea
            id={`approval-note-${row.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Ditampilkan ke pengaju jika ditolak."
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="success"
            size="sm"
            onClick={() => onDecide('APPROVE', note)}
            disabled={submitting}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Setujui
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => onDecide('REJECT', note)}
            disabled={submitting}
          >
            <XCircle className="h-4 w-4" aria-hidden />
            Tolak
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function summarize(r: AttendanceCorrection): string {
  const parts: string[] = [];
  if (r.requestedClockInAt) parts.push(`clock-in ${formatTime(r.requestedClockInAt)}`);
  if (r.requestedClockOutAt) parts.push(`clock-out ${formatTime(r.requestedClockOutAt)}`);
  return parts.length === 0 ? 'tidak ada perubahan' : parts.join(' · ');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', {
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatApiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'PAYROLL_LOCKED') {
      return 'Periode payroll sudah ditutup — keputusan tidak dapat diterapkan.';
    }
    if (err.code === 'NO_SHIFT_ASSIGNMENT') {
      return 'Pengaju tidak memiliki shift aktif untuk tanggal tersebut. Assign shift terlebih dahulu.';
    }
    if (err.code?.startsWith('CONFLICT_')) {
      return 'Attendance sudah tercatat pada slot ini — koreksi menabrak data yang ada.';
    }
    if (err.code === 'INVALID_TIME_ORDER') {
      return 'Jam pulang tidak boleh sebelum jam masuk.';
    }
    return err.message ?? err.code;
  }
  return 'Terjadi kesalahan tak dikenal.';
}
