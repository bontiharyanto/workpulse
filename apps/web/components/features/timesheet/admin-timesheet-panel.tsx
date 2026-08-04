'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';
import type {
  DecideTimesheetInput,
  ReopenTimesheetInput,
  TimesheetStatus,
  TimesheetSummaryDto,
} from '@workpulse/shared-types';
import { REOPEN_REASON_MIN, REOPEN_REASON_MAX } from '@workpulse/shared-types';

import { useAuth } from '@/components/providers/auth-provider';
import { ApiError, timesheetAdminApi } from '@/lib/api-client';

import { StatusBadge } from './my-timesheet-panel';

const ERROR_COPY: Record<string, string> = {
  THROTTLED: 'Terlalu banyak percobaan. Coba lagi sebentar.',
  TIMESHEET_ILLEGAL_TRANSITION:
    'Aksi tidak valid untuk status timesheet ini (mungkin sudah diubah oleh orang lain).',
  TIMESHEET_FORBIDDEN_SUPERVISOR:
    'Anda bukan supervisor karyawan tersebut.',
  TIMESHEET_FORBIDDEN_HR: 'Hanya HR yang berwenang.',
  TIMESHEET_REJECT_NOTE_REQUIRED:
    'Alasan penolakan wajib diisi.',
  TIMESHEET_REOPEN_FORBIDDEN:
    'Hanya HR Manager / Super Admin yang bisa membuka kembali timesheet.',
  TIMESHEET_REOPEN_STATUS_INVALID:
    'Hanya timesheet berstatus APPROVED yang bisa dibuka kembali.',
  TIMESHEET_REOPEN_REASON_INVALID:
    `Alasan reopen wajib diisi ${REOPEN_REASON_MIN}..${REOPEN_REASON_MAX} karakter.`,
};

const STATUS_FILTERS: Array<{ value: '' | TimesheetStatus; label: string }> = [
  { value: '', label: 'Semua' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_SUPERVISOR', label: 'Menunggu supervisor' },
  { value: 'PENDING_HR', label: 'Menunggu HR' },
  { value: 'APPROVED', label: 'Disetujui' },
  { value: 'REJECTED', label: 'Ditolak' },
];

/**
 * `/admin/timesheet` panel (Fase 32b).
 * - HR & Super Admin can generate, configure, and decide (HR-tier).
 * - Supervisor can decide (supervisor-tier) on their direct reports.
 */
export function AdminTimesheetPanel(): JSX.Element {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canConfigure =
    user?.role === 'HR_MANAGER' || user?.role === 'SUPER_ADMIN';
  const [periodId, setPeriodId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'' | TimesheetStatus>('');

  const periods = useQuery({
    queryKey: ['timesheet-periods'],
    queryFn: () => timesheetAdminApi.periods(),
    staleTime: 30_000,
  });

  const list = useQuery({
    queryKey: ['timesheet-admin-list', periodId, statusFilter],
    queryFn: () =>
      timesheetAdminApi.list({
        periodId: periodId || undefined,
        status: statusFilter || undefined,
      }),
  });

  const generate = useMutation({
    mutationFn: () => timesheetAdminApi.generate({}),
    onSuccess: async (res) => {
      setPeriodId(res.periodId);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['timesheet-periods'] }),
        qc.invalidateQueries({ queryKey: ['timesheet-admin-list'] }),
      ]);
    },
  });

  const decide = useMutation({
    mutationFn: ({ id, body }: { id: string; body: DecideTimesheetInput }) =>
      timesheetAdminApi.decide(id, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['timesheet-admin-list'] });
    },
  });

  const reopen = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReopenTimesheetInput }) =>
      timesheetAdminApi.reopen(id, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['timesheet-admin-list'] });
    },
  });

  const generateError = formatError(generate.error);
  const decideError = formatError(decide.error);
  const reopenError = formatError(reopen.error);

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-border bg-card p-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <label htmlFor="period" className="text-sm font-medium">
              Periode
            </label>
            <select
              id="period"
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value)}
              className="min-w-[240px] rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              aria-label="Pilih periode"
            >
              <option value="">Terbaru (default)</option>
              {(periods.data?.items ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.periodStart} → {p.periodEnd})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="status" className="text-sm font-medium">
              Status
            </label>
            <select
              id="status"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as '' | TimesheetStatus)
              }
              className="min-w-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              aria-label="Filter status"
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canConfigure ? (
            <Link
              href={'/admin/timesheet/config' as Route}
              className="inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Konfigurasi
            </Link>
          ) : null}
          {canConfigure ? (
            <Link
              href={'/admin/timesheet/exports' as Route}
              className="inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
              data-testid="ts-open-exports"
            >
              Export payroll
            </Link>
          ) : null}
          {canConfigure ? (
            <button
              type="button"
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generate.isPending ? 'Menghasilkan…' : 'Generate periode berjalan'}
            </button>
          ) : null}
        </div>
      </section>

      {generateError ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {generateError}
        </div>
      ) : null}
      {decideError ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {decideError}
        </div>
      ) : null}
      {reopenError ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {reopenError}
        </div>
      ) : null}

      {list.isLoading ? (
        <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
          Memuat…
        </div>
      ) : list.isError ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"
        >
          Gagal memuat daftar timesheet.
        </div>
      ) : (list.data?.items ?? []).length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
          Belum ada timesheet — klik “Generate periode berjalan”.
        </div>
      ) : (
        <section className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2 text-left">Karyawan</th>
                <th className="px-3 py-2 text-left">Periode</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Kerja</th>
                <th className="px-3 py-2 text-right">Lembur</th>
                <th className="px-3 py-2 text-right">Cuti</th>
                <th className="px-3 py-2 text-right">Absen</th>
                <th className="px-3 py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {(list.data?.items ?? []).map((row) => (
                <RowActions
                  key={row.id}
                  row={row}
                  role={user?.role ?? 'EMPLOYEE'}
                  pending={decide.isPending || reopen.isPending}
                  onDecide={(body) => decide.mutate({ id: row.id, body })}
                  onReopen={(body) => reopen.mutate({ id: row.id, body })}
                />
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        Total: {list.data?.total ?? 0} timesheet.
      </p>
    </div>
  );
}

function RowActions({
  row,
  role,
  pending,
  onDecide,
  onReopen,
}: {
  row: TimesheetSummaryDto;
  role: string;
  pending: boolean;
  onDecide: (body: DecideTimesheetInput) => void;
  onReopen: (body: ReopenTimesheetInput) => void;
}): JSX.Element {
  const [rejecting, setRejecting] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [note, setNote] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const isHr = role === 'HR_MANAGER' || role === 'SUPER_ADMIN';
  const isSupervisor = role === 'SUPERVISOR';

  const supervisorAction: 'approve' | 'reject' | null =
    row.status === 'PENDING_SUPERVISOR' && (isSupervisor || isHr) ? 'approve' : null;
  const hrAction: 'approve' | 'reject' | null =
    row.status === 'PENDING_HR' && isHr ? 'approve' : null;
  const canDecide = supervisorAction || hrAction;
  const canReopen = isHr && row.status === 'APPROVED';

  const submitReject = (): void => {
    if (!note.trim()) return;
    const action =
      row.status === 'PENDING_SUPERVISOR' ? 'SUPERVISOR_REJECT' : 'HR_REJECT';
    onDecide({ action, note: note.trim() });
    setRejecting(false);
    setNote('');
  };

  const submitApprove = (): void => {
    const action =
      row.status === 'PENDING_SUPERVISOR'
        ? 'SUPERVISOR_APPROVE'
        : 'HR_APPROVE';
    onDecide({ action, note: note.trim() || undefined });
    setNote('');
  };

  const submitReopen = (): void => {
    const reason = reopenReason.trim();
    if (reason.length < REOPEN_REASON_MIN) return;
    onReopen({ reason });
    setReopening(false);
    setReopenReason('');
  };

  return (
    <>
      <tr className="border-b last:border-b-0">
        <td className="px-3 py-2">
          <div className="font-medium">{row.user.fullName}</div>
          <div className="text-xs text-muted-foreground">{row.user.email}</div>
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground">
          {row.periodLabel}
          <div className="text-[10px]">{row.periodStart} → {row.periodEnd}</div>
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-col items-start gap-1">
            <StatusBadge status={row.status} />
            {row.reopenCount > 0 ? (
              <span
                className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                title={row.lastReopenReason ?? undefined}
                data-testid={`ts-reopen-badge-${row.id}`}
              >
                Reopened ×{row.reopenCount}
              </span>
            ) : null}
          </div>
        </td>
        <td className="px-3 py-2 text-right font-mono">
          {row.totals.regularHours.toFixed(2)}
        </td>
        <td className="px-3 py-2 text-right font-mono">
          {row.totals.overtimeHours.toFixed(2)}
        </td>
        <td className="px-3 py-2 text-right font-mono">
          {row.totals.leaveDays}
        </td>
        <td className="px-3 py-2 text-right font-mono">
          {row.totals.absentDays}
        </td>
        <td className="px-3 py-2 text-right">
          {canDecide ? (
            <div className="inline-flex gap-2">
              <button
                type="button"
                onClick={submitApprove}
                disabled={pending}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                data-testid={`ts-approve-${row.id}`}
              >
                Setujui
              </button>
              <button
                type="button"
                onClick={() => setRejecting((v) => !v)}
                disabled={pending}
                className="rounded-md border border-destructive/50 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/5 disabled:opacity-50"
                data-testid={`ts-reject-${row.id}`}
              >
                Tolak
              </button>
            </div>
          ) : canReopen ? (
            <button
              type="button"
              onClick={() => setReopening((v) => !v)}
              disabled={pending}
              className="rounded-md border border-amber-500/60 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:text-amber-300 dark:hover:bg-amber-900/20"
              data-testid={`ts-reopen-${row.id}`}
            >
              Buka kembali
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          )}
        </td>
      </tr>
      {rejecting && canDecide && (
        <tr className="border-b bg-muted/40">
          <td colSpan={8} className="px-3 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[240px]">
                <label
                  htmlFor={`reject-note-${row.id}`}
                  className="text-xs font-medium"
                >
                  Alasan penolakan
                </label>
                <textarea
                  id={`reject-note-${row.id}`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Jelaskan yang perlu dikoreksi karyawan…"
                  data-testid={`ts-reject-note-${row.id}`}
                />
              </div>
              <button
                type="button"
                onClick={submitReject}
                disabled={pending || !note.trim()}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                data-testid={`ts-reject-confirm-${row.id}`}
              >
                Kirim penolakan
              </button>
            </div>
          </td>
        </tr>
      )}
      {reopening && canReopen && (
        <tr className="border-b bg-amber-50/60 dark:bg-amber-900/10">
          <td colSpan={8} className="px-3 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[280px]">
                <label
                  htmlFor={`reopen-reason-${row.id}`}
                  className="text-xs font-medium"
                >
                  Alasan reopen (wajib, {REOPEN_REASON_MIN}–{REOPEN_REASON_MAX}{' '}
                  karakter)
                </label>
                <textarea
                  id={`reopen-reason-${row.id}`}
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  maxLength={REOPEN_REASON_MAX}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Contoh: OT rate revised post-payroll — mohon submit ulang setelah verifikasi."
                  data-testid={`ts-reopen-reason-${row.id}`}
                />
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Timesheet direset ke DRAFT; karyawan submit ulang → supervisor
                  → HR. Webhook <code>timesheet.reopened</code> akan dikirim ke
                  vendor payroll.
                </div>
              </div>
              <button
                type="button"
                onClick={submitReopen}
                disabled={
                  pending || reopenReason.trim().length < REOPEN_REASON_MIN
                }
                className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                data-testid={`ts-reopen-confirm-${row.id}`}
              >
                Konfirmasi buka kembali
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function formatError(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof ApiError) {
    return ERROR_COPY[err.code] ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Terjadi kesalahan.';
}
