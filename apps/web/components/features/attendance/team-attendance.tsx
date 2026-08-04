'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AbsenceSource,
  TeamAttendanceStatus,
  TeamMemberDailyRow,
  TeamMemberSummaryRow,
} from '@workpulse/shared-types';
import { AlertTriangle, Bot, Inbox, Lock, User2, UserX, X } from 'lucide-react';
import { useMemo, useState, type JSX, type ReactNode } from 'react';

import { useAuth } from '@/components/providers/auth-provider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { attendanceApi, companyAdminApi } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { StatusBadge } from './_shared/status-badge';

/**
 * Team attendance panel for supervisors and HR. Two tabs:
 *   - "Hari ini" — roster + today's clock-in status. HR can mark a
 *     row absent or revoke an absence.
 *   - "Rekap" — per-member summary over a rolling range (7/14/30).
 *
 * Access control is enforced server-side; the client just hides
 * the entry point from employees so they don't hit a 403.
 *
 * Fase 4 rework:
 *   - Migrated to shadcn `<Card>` / `<Tabs>` / `<Table>` / `<Badge>`.
 *   - `window.confirm()` for "revoke absence" replaced with a
 *     branded `<AlertDialog>` per rules/20-security-and-business...
 *   - Payroll-locked warning is now a proper `<Alert variant="warning">`.
 */

type Tab = 'today' | 'summary';
type RangePreset = '7' | '14' | '30';

export function TeamAttendance(): JSX.Element | null {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('today');
  const [range, setRange] = useState<RangePreset>('7');
  const [date, setDate] = useState<string>(() => toIsoDate(new Date()));

  const canView =
    !!user &&
    (user.role === 'SUPERVISOR' || user.role === 'HR_MANAGER' || user.role === 'SUPER_ADMIN');
  const canOverrideAbsence = !!user && (user.role === 'HR_MANAGER' || user.role === 'SUPER_ADMIN');

  if (!canView) return null;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="today">Hari ini</TabsTrigger>
          <TabsTrigger value="summary">Rekap</TabsTrigger>
        </TabsList>

        {tab === 'today' ? (
          <div className="flex items-center gap-2">
            <Label htmlFor="team-attendance-date" className="text-muted-foreground text-caption">
              Tanggal
            </Label>
            <Input
              id="team-attendance-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={toIsoDate(new Date())}
              className="w-auto"
            />
          </div>
        ) : (
          <Tabs value={range} onValueChange={(v) => setRange(v as RangePreset)}>
            <TabsList>
              <TabsTrigger value="7">7 hari</TabsTrigger>
              <TabsTrigger value="14">14 hari</TabsTrigger>
              <TabsTrigger value="30">30 hari</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      {tab === 'today' ? (
        <TodayTable date={date} canOverrideAbsence={canOverrideAbsence} />
      ) : (
        <SummaryTable range={range} />
      )}
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

interface DeleteTarget {
  absenceRecordId: string;
  fullName: string;
  date: string;
}

function TodayTable({
  date,
  canOverrideAbsence,
}: {
  date: string;
  canOverrideAbsence: boolean;
}): JSX.Element {
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ['attendance', 'team', 'today', date],
    queryFn: () => attendanceApi.teamToday({ date }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Fetch company config (payroll cutoff) only when HR-level access.
  const config = useQuery({
    queryKey: ['company', 'config'],
    queryFn: () => companyAdminApi.get(),
    enabled: canOverrideAbsence,
    staleTime: 5 * 60_000,
  });
  const payrollLockedUntil = config.data?.payrollLockedUntil ?? null;
  const dateIsLocked = !!payrollLockedUntil && date <= payrollLockedUntil;

  const [openMarkFor, setOpenMarkFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const markMutation = useMutation({
    mutationFn: attendanceApi.markAbsent,
    onSuccess: async () => {
      setOpenMarkFor(null);
      setReason('');
      setErrorMsg(null);
      await qc.invalidateQueries({ queryKey: ['attendance', 'team', 'today', date] });
      await qc.invalidateQueries({ queryKey: ['attendance', 'dashboard'] });
    },
    onError: (err: unknown) => setErrorMsg(errorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => attendanceApi.deleteAbsence(id),
    onSuccess: async () => {
      setDeleteTarget(null);
      await qc.invalidateQueries({ queryKey: ['attendance', 'team', 'today', date] });
      await qc.invalidateQueries({ queryKey: ['attendance', 'dashboard'] });
    },
  });

  const colCount = canOverrideAbsence ? 7 : 6;

  return (
    <div className="space-y-4">
      {canOverrideAbsence && dateIsLocked ? (
        <Alert variant="warning">
          <Lock aria-hidden />
          <AlertTitle>Periode terkunci payroll</AlertTitle>
          <AlertDescription>
            <span className="tabular-nums">{date}</span> berada di dalam cutoff{' '}
            <code className="bg-background/60 text-caption rounded px-1 font-mono">
              {payrollLockedUntil}
            </code>
            . HR tidak dapat menandai / mencabut absen pada tanggal ini; hubungi Super Admin untuk
            koreksi.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Departemen</TableHead>
                <TableHead>Clock-in</TableHead>
                <TableHead>Clock-out</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Telat</TableHead>
                {canOverrideAbsence ? <TableHead className="text-right">Aksi</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading ? (
                <RowsSkeleton cols={colCount} />
              ) : list.data && list.data.length > 0 ? (
                list.data.map((r) => (
                  <TodayRow
                    key={r.userId}
                    row={r}
                    date={date}
                    canOverride={canOverrideAbsence}
                    dateIsLocked={dateIsLocked}
                    isMarkOpen={openMarkFor === r.userId}
                    reason={reason}
                    errorMsg={openMarkFor === r.userId ? errorMsg : null}
                    onOpenMark={() => {
                      setOpenMarkFor(r.userId);
                      setReason('');
                      setErrorMsg(null);
                    }}
                    onCancelMark={() => {
                      setOpenMarkFor(null);
                      setReason('');
                      setErrorMsg(null);
                    }}
                    onReasonChange={setReason}
                    onSubmitMark={() => {
                      markMutation.mutate({
                        userId: r.userId,
                        workDate: date,
                        reason: reason.trim() ? reason.trim() : undefined,
                      });
                    }}
                    isSubmitting={markMutation.isPending && openMarkFor === r.userId}
                    onRequestDelete={(target) => setDeleteTarget(target)}
                  />
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={colCount}>
                    <EmptyState message="Tidak ada anggota tim dalam scope Anda." />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan status absen?</AlertDialogTitle>
            <AlertDialogDescription>
              Anda akan mencabut status absen untuk{' '}
              <span className="text-foreground font-medium">{deleteTarget?.fullName}</span> pada{' '}
              <span className="text-foreground font-medium tabular-nums">{deleteTarget?.date}</span>
              . Aksi ini tercatat di audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.absenceRecordId);
              }}
            >
              {deleteMutation.isPending ? 'Menghapus…' : 'Ya, batalkan absen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface TodayRowProps {
  row: TeamMemberDailyRow;
  date: string;
  canOverride: boolean;
  dateIsLocked: boolean;
  isMarkOpen: boolean;
  reason: string;
  errorMsg: string | null;
  onOpenMark: () => void;
  onCancelMark: () => void;
  onReasonChange: (v: string) => void;
  onSubmitMark: () => void;
  isSubmitting: boolean;
  onRequestDelete: (target: DeleteTarget) => void;
}

function TodayRow(props: TodayRowProps): JSX.Element {
  const {
    row,
    date,
    canOverride,
    dateIsLocked,
    isMarkOpen,
    reason,
    errorMsg,
    onOpenMark,
    onCancelMark,
    onReasonChange,
    onSubmitMark,
    isSubmitting,
    onRequestDelete,
  } = props;

  const colCount = canOverride ? 7 : 6;

  return (
    <>
      <TableRow>
        <TableCell>
          <div className="flex items-center gap-2">
            <div className="bg-muted text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
              <User2 className="h-4 w-4" aria-hidden />
            </div>
            <div>
              <div className="text-body font-medium">{row.fullName}</div>
              <div className="text-muted-foreground text-caption">{row.email}</div>
            </div>
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground text-caption">
          {row.departmentName ?? '—'}
        </TableCell>
        <TableCell className="tabular-nums">
          {row.clockInAt ? formatTime(row.clockInAt) : <MutedDash />}
        </TableCell>
        <TableCell className="tabular-nums">
          {row.clockOutAt ? formatTime(row.clockOutAt) : <MutedDash />}
        </TableCell>
        <TableCell>
          <div className="flex flex-col items-start gap-1">
            <StatusBadge status={row.status as TeamAttendanceStatus} />
            {row.status === 'ABSENT' && row.absenceSource ? (
              <AbsenceSourcePill source={row.absenceSource} />
            ) : null}
          </div>
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {row.lateMinutes > 0 ? (
            <span className="text-warning font-medium">{row.lateMinutes}m</span>
          ) : (
            <MutedDash />
          )}
        </TableCell>
        {canOverride ? (
          <TableCell className="text-right">
            {row.status === 'NOT_CLOCKED_IN' && !isMarkOpen ? (
              <Button
                size="sm"
                variant="outline"
                onClick={onOpenMark}
                disabled={dateIsLocked}
                title={dateIsLocked ? 'Periode terkunci payroll' : undefined}
              >
                <UserX className="h-3.5 w-3.5" aria-hidden />
                Absenkan
              </Button>
            ) : null}
            {row.status === 'ABSENT' && row.absenceRecordId ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onRequestDelete({
                    absenceRecordId: row.absenceRecordId as string,
                    fullName: row.fullName,
                    date,
                  })
                }
                disabled={dateIsLocked}
                title={dateIsLocked ? 'Periode terkunci payroll' : undefined}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                Batalkan
              </Button>
            ) : null}
          </TableCell>
        ) : null}
      </TableRow>
      {isMarkOpen ? (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={colCount}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSubmitMark();
              }}
              className="flex flex-wrap items-end gap-3"
            >
              <div className="min-w-[280px] flex-1 space-y-1.5">
                <Label htmlFor={`mark-reason-${row.userId}`} className="text-caption">
                  Alasan (opsional, maks. 500 karakter)
                </Label>
                <Input
                  id={`mark-reason-${row.userId}`}
                  autoFocus
                  value={reason}
                  onChange={(e) => onReasonChange(e.target.value)}
                  maxLength={500}
                  placeholder={`Contoh: ${row.fullName} tidak masuk tanpa keterangan.`}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" variant="destructive" disabled={isSubmitting}>
                  {isSubmitting ? 'Menyimpan…' : 'Konfirmasi absen'}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={onCancelMark}>
                  Batal
                </Button>
              </div>
              {errorMsg ? (
                <p className="text-destructive text-caption inline-flex w-full items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  {errorMsg}
                </p>
              ) : null}
            </form>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function AbsenceSourcePill({ source }: { source: AbsenceSource }): JSX.Element {
  const isAuto = source === 'AUTO_SCHEDULER';
  return (
    <Badge variant="muted" className="gap-1 text-[10px]">
      {isAuto ? <Bot className="h-3 w-3" aria-hidden /> : <User2 className="h-3 w-3" aria-hidden />}
      {isAuto ? 'Otomatis' : 'HR'}
    </Badge>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.message === 'CLOCKED_IN') return 'Karyawan sudah melakukan clock-in pada tanggal ini.';
    if (err.message === 'ALREADY_MARKED') return 'Karyawan sudah tercatat absen pada tanggal ini.';
    if (err.message === 'DATE_IN_FUTURE') return 'Tanggal tidak boleh di masa depan.';
    if (err.message === 'NOT_HIRED_YET') return 'Karyawan belum aktif pada tanggal tersebut.';
    if (err.message === 'PAYROLL_LOCKED')
      return 'Tanggal ini berada dalam periode payroll yang sudah terkunci. Hanya Super Admin yang dapat memodifikasi.';
    return err.message;
  }
  return 'Terjadi kesalahan. Coba lagi.';
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function SummaryTable({ range }: { range: RangePreset }): JSX.Element {
  const days = Number(range);
  const { from, to } = useMemo(() => {
    const t = new Date();
    const f = new Date(t);
    f.setUTCDate(f.getUTCDate() - (days - 1));
    return { from: toIsoDate(f), to: toIsoDate(t) };
  }, [days]);

  const query = useQuery({
    queryKey: ['attendance', 'team', 'summary', from, to],
    queryFn: () => attendanceApi.teamSummary({ from, to }),
    staleTime: 60_000,
  });

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-caption">
        Rentang: <span className="tabular-nums">{from}</span> →{' '}
        <span className="tabular-nums">{to}</span> · {days} hari
      </p>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Departemen</TableHead>
                <TableHead className="text-right">Hadir</TableHead>
                <TableHead className="text-right">Tepat waktu</TableHead>
                <TableHead className="text-right">Terlambat</TableHead>
                <TableHead className="text-right">Absen</TableHead>
                <TableHead className="text-right">Menit telat</TableHead>
                <TableHead className="text-right">Total jam</TableHead>
                <TableHead className="text-right">On-time %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? (
                <RowsSkeleton cols={9} />
              ) : query.data && query.data.rows.length > 0 ? (
                query.data.rows.map((r) => <SummaryRow key={r.userId} row={r} />)
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={9}>
                    <EmptyState message="Tidak ada data pada rentang ini." />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryRow({ row }: { row: TeamMemberSummaryRow }): JSX.Element {
  const rate = row.onTimeRatePercent;
  const rateClass =
    rate === null
      ? 'text-muted-foreground'
      : rate >= 90
        ? 'text-success'
        : rate >= 75
          ? 'text-warning'
          : 'text-destructive';

  return (
    <TableRow>
      <TableCell>
        <div className="text-body font-medium">{row.fullName}</div>
        <div className="text-muted-foreground text-caption">{row.email}</div>
      </TableCell>
      <TableCell className="text-muted-foreground text-caption">
        {row.departmentName ?? '—'}
      </TableCell>
      <TableCell className="text-right tabular-nums">{row.presentDays}</TableCell>
      <TableCell className="text-success text-right tabular-nums">{row.onTimeDays}</TableCell>
      <TableCell className="text-right tabular-nums">
        {row.lateDays > 0 ? (
          <span className="text-warning font-medium">{row.lateDays}</span>
        ) : (
          <MutedDash />
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {row.absentDays > 0 ? (
          <span className="text-destructive font-medium">{row.absentDays}</span>
        ) : (
          <MutedDash />
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {row.totalLateMinutes > 0 ? row.totalLateMinutes : <MutedDash />}
      </TableCell>
      <TableCell className="text-right tabular-nums">{row.totalHoursWorked.toFixed(1)}</TableCell>
      <TableCell className={cn('text-right font-medium tabular-nums', rateClass)}>
        {rate === null ? '—' : `${rate.toFixed(1)}%`}
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function RowsSkeleton({ cols }: { cols: number }): JSX.Element {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i} className="hover:bg-transparent">
          {Array.from({ length: cols }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full max-w-[100px]" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function EmptyState({ message }: { message: string }): ReactNode {
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-2 py-8">
      <Inbox className="h-6 w-6" aria-hidden />
      <p className="text-body">{message}</p>
    </div>
  );
}

function MutedDash(): JSX.Element {
  return <span className="text-muted-foreground">—</span>;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
