'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DecideTimesheetInput,
  ReopenTimesheetInput,
  TimesheetStatus,
  TimesheetSummaryDto,
} from '@workpulse/shared-types';
import { REOPEN_REASON_MAX, REOPEN_REASON_MIN } from '@workpulse/shared-types';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronUp,
  Cog,
  Download,
  Inbox,
  RotateCcw,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, type JSX } from 'react';

import { useAuth } from '@/components/providers/auth-provider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, timesheetAdminApi } from '@/lib/api-client';

import { TimesheetStatusBadge } from './timesheet-status-badge';

const ERROR_COPY: Record<string, string> = {
  THROTTLED: 'Terlalu banyak percobaan. Coba lagi sebentar.',
  TIMESHEET_ILLEGAL_TRANSITION:
    'Aksi tidak valid untuk status timesheet ini (mungkin sudah diubah oleh orang lain).',
  TIMESHEET_FORBIDDEN_SUPERVISOR: 'Anda bukan supervisor karyawan tersebut.',
  TIMESHEET_FORBIDDEN_HR: 'Hanya HR yang berwenang.',
  TIMESHEET_REJECT_NOTE_REQUIRED: 'Alasan penolakan wajib diisi.',
  TIMESHEET_REOPEN_FORBIDDEN: 'Hanya HR Manager / Super Admin yang bisa membuka kembali timesheet.',
  TIMESHEET_REOPEN_STATUS_INVALID: 'Hanya timesheet berstatus APPROVED yang bisa dibuka kembali.',
  TIMESHEET_REOPEN_REASON_INVALID: `Alasan reopen wajib diisi ${REOPEN_REASON_MIN}..${REOPEN_REASON_MAX} karakter.`,
};

const STATUS_FILTERS: Array<{ value: 'ALL' | TimesheetStatus; label: string }> = [
  { value: 'ALL', label: 'Semua' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_SUPERVISOR', label: 'Menunggu supervisor' },
  { value: 'PENDING_HR', label: 'Menunggu HR' },
  { value: 'APPROVED', label: 'Disetujui' },
  { value: 'REJECTED', label: 'Ditolak' },
];

/**
 * `/admin/timesheet` approval queue.
 *
 * INVARIANTS (rules/20 §3–4):
 * - Client role checks are UX only. Server `@Roles` guard is the
 *   real authorization.
 * - The approval state machine (PENDING_SUPERVISOR → PENDING_HR →
 *   APPROVED, or reject to REJECTED, or reopen APPROVED → DRAFT)
 *   is enforced server-side. FE only exposes valid transitions.
 * - Reject requires `note`, reopen requires reason `10..500`
 *   characters — Zod-enforced on the server too.
 */
export function AdminTimesheetPanel(): JSX.Element {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canConfigure = user?.role === 'HR_MANAGER' || user?.role === 'SUPER_ADMIN';

  const [periodId, setPeriodId] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | TimesheetStatus>('ALL');

  const periods = useQuery({
    queryKey: ['timesheet-periods'],
    queryFn: () => timesheetAdminApi.periods(),
    staleTime: 30_000,
  });

  const list = useQuery({
    queryKey: ['timesheet-admin-list', periodId, statusFilter],
    queryFn: () =>
      timesheetAdminApi.list({
        periodId: periodId === 'ALL' ? undefined : periodId,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
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
      <Card>
        <CardContent className="flex flex-wrap items-end justify-between gap-4 p-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[240px] space-y-1.5">
              <Label htmlFor="ts-filter-period">Periode</Label>
              <Select value={periodId} onValueChange={setPeriodId}>
                <SelectTrigger id="ts-filter-period" aria-label="Pilih periode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Terbaru (default)</SelectItem>
                  {(periods.data?.items ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label} ({p.periodStart} → {p.periodEnd})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[200px] space-y-1.5">
              <Label htmlFor="ts-filter-status">Status</Label>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as 'ALL' | TimesheetStatus)}
              >
                <SelectTrigger id="ts-filter-status" aria-label="Filter status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTERS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {canConfigure ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={'/admin/timesheet/config' as Route}>
                  <Cog className="h-4 w-4" aria-hidden />
                  Konfigurasi
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={'/admin/timesheet/exports' as Route} data-testid="ts-open-exports">
                  <Download className="h-4 w-4" aria-hidden />
                  Export payroll
                </Link>
              </Button>
              <Button size="sm" onClick={() => generate.mutate()} disabled={generate.isPending}>
                <Sparkles className="h-4 w-4" aria-hidden />
                {generate.isPending ? 'Menghasilkan…' : 'Generate periode berjalan'}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {generateError ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>Gagal generate timesheet</AlertTitle>
          <AlertDescription>{generateError}</AlertDescription>
        </Alert>
      ) : null}
      {decideError ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>Keputusan tidak dapat disimpan</AlertTitle>
          <AlertDescription>{decideError}</AlertDescription>
        </Alert>
      ) : null}
      {reopenError ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>Tidak dapat membuka kembali timesheet</AlertTitle>
          <AlertDescription>{reopenError}</AlertDescription>
        </Alert>
      ) : null}

      {list.isLoading ? (
        <Card>
          <CardContent className="space-y-3 p-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </CardContent>
        </Card>
      ) : list.isError ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>Gagal memuat daftar timesheet</AlertTitle>
          <AlertDescription>Coba muat ulang halaman.</AlertDescription>
        </Alert>
      ) : (list.data?.items ?? []).length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-12">
            <Inbox className="h-8 w-8" aria-hidden />
            <p className="text-h6 text-foreground">Belum ada timesheet</p>
            <p className="text-caption">Klik “Generate periode berjalan” untuk mulai.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-0" />
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Karyawan</TableHead>
                  <TableHead>Periode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Kerja</TableHead>
                  <TableHead className="text-right">Lembur</TableHead>
                  <TableHead className="text-right">Cuti</TableHead>
                  <TableHead className="text-right">Absen</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
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
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <p className="text-muted-foreground text-caption">
        Total: <span className="tabular-nums">{list.data?.total ?? 0}</span> timesheet.
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

  const canDecide =
    (row.status === 'PENDING_SUPERVISOR' && (isSupervisor || isHr)) ||
    (row.status === 'PENDING_HR' && isHr);
  const canReopen = isHr && row.status === 'APPROVED';

  const submitReject = (): void => {
    const trimmed = note.trim();
    if (!trimmed) return;
    const action = row.status === 'PENDING_SUPERVISOR' ? 'SUPERVISOR_REJECT' : 'HR_REJECT';
    onDecide({ action, note: trimmed });
    setRejecting(false);
    setNote('');
  };

  const submitApprove = (): void => {
    const action = row.status === 'PENDING_SUPERVISOR' ? 'SUPERVISOR_APPROVE' : 'HR_APPROVE';
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
      <TableRow>
        <TableCell>
          <div className="text-body font-medium">{row.user.fullName}</div>
          <div className="text-muted-foreground text-caption">{row.user.email}</div>
        </TableCell>
        <TableCell>
          <div className="text-body">{row.periodLabel}</div>
          <div className="text-muted-foreground text-caption tabular-nums">
            {row.periodStart} → {row.periodEnd}
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-col items-start gap-1">
            <TimesheetStatusBadge status={row.status} />
            {row.reopenCount > 0 ? (
              <Badge
                variant="warning"
                title={row.lastReopenReason ?? undefined}
                data-testid={`ts-reopen-badge-${row.id}`}
              >
                Reopened ×{row.reopenCount}
              </Badge>
            ) : null}
          </div>
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          {row.totals.regularHours.toFixed(2)}
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          {row.totals.overtimeHours.toFixed(2)}
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">{row.totals.leaveDays}</TableCell>
        <TableCell className="text-right font-mono tabular-nums">{row.totals.absentDays}</TableCell>
        <TableCell className="text-right">
          {canDecide ? (
            <div className="inline-flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="success"
                onClick={submitApprove}
                disabled={pending}
                data-testid={`ts-approve-${row.id}`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                Setujui
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRejecting((v) => !v)}
                disabled={pending}
                data-testid={`ts-reject-${row.id}`}
                className="border-destructive/50 text-destructive hover:bg-destructive/5"
              >
                {rejecting ? (
                  <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <XCircle className="h-3.5 w-3.5" aria-hidden />
                )}
                Tolak
              </Button>
            </div>
          ) : canReopen ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReopening((v) => !v)}
              disabled={pending}
              data-testid={`ts-reopen-${row.id}`}
              className="border-warning/60 text-warning hover:bg-warning/10"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Buka kembali
            </Button>
          ) : (
            <span className="text-muted-foreground text-caption">-</span>
          )}
        </TableCell>
      </TableRow>

      {rejecting && canDecide ? (
        <TableRow className="bg-muted/40">
          <TableCell colSpan={8} className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[240px] flex-1 space-y-1.5">
                <Label htmlFor={`reject-note-${row.id}`}>Alasan penolakan</Label>
                <Textarea
                  id={`reject-note-${row.id}`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="Jelaskan yang perlu dikoreksi karyawan…"
                  data-testid={`ts-reject-note-${row.id}`}
                />
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={submitReject}
                disabled={pending || !note.trim()}
                data-testid={`ts-reject-confirm-${row.id}`}
              >
                <XCircle className="h-3.5 w-3.5" aria-hidden />
                Kirim penolakan
              </Button>
            </div>
          </TableCell>
        </TableRow>
      ) : null}

      {reopening && canReopen ? (
        <TableRow className="bg-warning/5">
          <TableCell colSpan={8} className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[280px] flex-1 space-y-1.5">
                <Label htmlFor={`reopen-reason-${row.id}`}>
                  Alasan reopen (wajib, {REOPEN_REASON_MIN}–{REOPEN_REASON_MAX} karakter)
                </Label>
                <Textarea
                  id={`reopen-reason-${row.id}`}
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  maxLength={REOPEN_REASON_MAX}
                  rows={2}
                  placeholder="Contoh: OT rate revised post-payroll — mohon submit ulang setelah verifikasi."
                  data-testid={`ts-reopen-reason-${row.id}`}
                />
                <p className="text-muted-foreground text-caption">
                  Timesheet direset ke DRAFT; karyawan submit ulang → supervisor → HR. Webhook{' '}
                  <code>timesheet.reopened</code> akan dikirim ke vendor payroll.
                </p>
              </div>
              <Button
                size="sm"
                onClick={submitReopen}
                disabled={pending || reopenReason.trim().length < REOPEN_REASON_MIN}
                data-testid={`ts-reopen-confirm-${row.id}`}
                className="bg-warning text-warning-foreground hover:bg-warning/90"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Konfirmasi buka kembali
              </Button>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
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
