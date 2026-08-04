'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AttendanceCorrection } from '@workpulse/shared-types';

import { ApiError, attendanceCorrectionsApi } from '@/lib/api-client';

/**
 * Employee's own corrections list. Latest 100. Cancel available on any
 * PENDING_APPROVAL row (the API also enforces owner-only and cutoff).
 */
export function CorrectionList(): JSX.Element {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['attendance', 'corrections', 'mine'],
    queryFn: attendanceCorrectionsApi.listMine,
    staleTime: 30_000,
  });

  const cancel = useMutation({
    mutationFn: (id: string) => attendanceCorrectionsApi.cancel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance', 'corrections', 'mine'] });
    },
  });

  if (list.isLoading) {
    return <p className="text-muted-foreground text-sm">Memuat riwayat koreksi...</p>;
  }
  if (list.isError) {
    return <p className="text-destructive text-sm">Gagal memuat riwayat koreksi.</p>;
  }
  const rows = list.data ?? [];
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">Belum ada koreksi yang diajukan.</p>;
  }

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Riwayat koreksi Anda</h2>
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground text-left text-xs uppercase tracking-wider">
            <tr>
              <th className="px-3 py-2">Tanggal</th>
              <th className="px-3 py-2">Diminta</th>
              <th className="px-3 py-2">Alasan</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t align-top">
                <td className="px-3 py-2 tabular-nums">{formatDate(r.workDate)}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{summarize(r)}</td>
                <td className="text-muted-foreground max-w-xs truncate px-3 py-2 text-xs">
                  {r.reason}
                </td>
                <td className="px-3 py-2">
                  <StatusPill status={r.status} />
                </td>
                <td className="px-3 py-2 text-right">
                  {r.status === 'PENDING_APPROVAL' ? (
                    <button
                      type="button"
                      onClick={() => cancel.mutate(r.id)}
                      disabled={cancel.isPending}
                      className="text-destructive text-xs hover:underline disabled:opacity-50"
                    >
                      Batalkan
                    </button>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cancel.isError ? (
        <p className="text-destructive text-xs">{formatApiError(cancel.error)}</p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------

function summarize(r: AttendanceCorrection): string {
  const parts: string[] = [];
  if (r.requestedClockInAt) parts.push(`in ${formatTime(r.requestedClockInAt)}`);
  if (r.requestedClockOutAt) parts.push(`out ${formatTime(r.requestedClockOutAt)}`);
  return parts.length === 0 ? '—' : parts.join(', ');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusPill({ status }: { status: AttendanceCorrection['status'] }): JSX.Element {
  const { label, cls } = pillStyle(status);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

function pillStyle(status: AttendanceCorrection['status']): { label: string; cls: string } {
  switch (status) {
    case 'PENDING_APPROVAL':
      return { label: 'Menunggu', cls: 'bg-amber-100 text-amber-800' };
    case 'APPROVED':
      return { label: 'Disetujui', cls: 'bg-emerald-100 text-emerald-800' };
    case 'REJECTED':
      return { label: 'Ditolak', cls: 'bg-destructive/10 text-destructive' };
    case 'CANCELLED':
      return { label: 'Dibatalkan', cls: 'bg-muted text-muted-foreground' };
    default:
      return { label: status, cls: 'bg-muted text-muted-foreground' };
  }
}

function formatApiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'PAYROLL_LOCKED') {
      return 'Periode payroll sudah ditutup — permintaan tidak dapat dibatalkan.';
    }
    return err.message ?? err.code;
  }
  return 'Terjadi kesalahan tak dikenal.';
}
