'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AttendanceCorrection } from '@workpulse/shared-types';
import { useState } from 'react';


import { ApiError, attendanceCorrectionsApi } from '@/lib/api-client';

/**
 * Approver queue — pending corrections. Server scopes the list to:
 *   - SUPERVISOR: only the caller's direct reports.
 *   - HR_MANAGER / SUPER_ADMIN: the entire tenant.
 *
 * Each row expands inline into a decision form (note + APPROVE/REJECT
 * buttons). Rejection notes are surfaced back to the requester via the
 * notification content.
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
      qc.invalidateQueries({ queryKey: ['attendance', 'corrections', 'pending'] });
    },
  });

  if (list.isLoading) {
    return <p className="text-muted-foreground text-sm">Memuat...</p>;
  }
  if (list.isError) {
    return <p className="text-destructive text-sm">Gagal memuat daftar.</p>;
  }
  const rows = list.data ?? [];
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">Tidak ada koreksi menunggu keputusan.</p>;
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
        <p className="text-destructive text-xs">{formatApiError(decide.error)}</p>
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
    <article className="space-y-3 rounded-md border p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {row.userFullName ?? row.userId} · {formatDate(row.workDate)}
          </p>
          <p className="text-muted-foreground text-xs">{summarize(row)}</p>
        </div>
        {row.attachmentUrl ? (
          <a
            href={row.attachmentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary text-xs underline"
          >
            Lampiran
          </a>
        ) : null}
      </header>
      <p className="text-sm">{row.reason}</p>
      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground font-medium">Catatan keputusan (opsional)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={500}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          placeholder="Ditampilkan ke pengaju jika ditolak."
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onDecide('APPROVE', note)}
          disabled={submitting}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          Setujui
        </button>
        <button
          type="button"
          onClick={() => onDecide('REJECT', note)}
          disabled={submitting}
          className="bg-destructive text-destructive-foreground rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          Tolak
        </button>
      </div>
    </article>
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
