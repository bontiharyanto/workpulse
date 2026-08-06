'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TimesheetSummaryDto, TimesheetViewDto } from '@workpulse/shared-types';
import { AlertTriangle, CalendarClock, Inbox, Send } from 'lucide-react';
import { type JSX } from 'react';

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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { timesheetSelfApi } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { TimesheetStatusBadge } from './timesheet-status-badge';

/**
 * `/me/timesheet` main widget. Renders the current-period timesheet
 * grid + totals + a short list of past periods.
 *
 * INVARIANT: totals, entries, and period boundaries are server-
 * materialized. The FE never re-aggregates — it only formats the
 * numbers the API returns and forwards submit intent as-is.
 */
export function MyTimesheetPanel(): JSX.Element {
  const queryClient = useQueryClient();
  const current = useQuery({
    queryKey: ['my-timesheet-current'],
    queryFn: () => timesheetSelfApi.current(),
  });
  const list = useQuery({
    queryKey: ['my-timesheet-list'],
    queryFn: () => timesheetSelfApi.list(12),
    staleTime: 30_000,
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) => timesheetSelfApi.submit(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['my-timesheet-current'] }),
        queryClient.invalidateQueries({ queryKey: ['my-timesheet-list'] }),
      ]);
    },
  });

  return (
    <div className="space-y-6">
      <CurrentPeriodCard
        data={current.data ?? null}
        loading={current.isLoading}
        error={current.isError}
        onSubmit={(id) => submitMutation.mutate(id)}
        submitPending={submitMutation.isPending}
        submitError={submitMutation.error instanceof Error ? submitMutation.error.message : null}
      />
      <PastPeriodsList items={list.data ?? []} loading={list.isLoading} error={list.isError} />
    </div>
  );
}

const KIND_LABEL: Record<TimesheetViewDto['entries'][number]['kind'], string> = {
  WORKING: 'Kerja',
  HOLIDAY: 'Libur nasional',
  WEEKEND: 'Akhir pekan',
  LEAVE: 'Cuti',
  ABSENT: 'Absen',
};

const KIND_TONE: Record<TimesheetViewDto['entries'][number]['kind'], string> = {
  WORKING: 'text-foreground',
  HOLIDAY: 'text-warning',
  WEEKEND: 'text-muted-foreground',
  LEAVE: 'text-info',
  ABSENT: 'text-destructive',
};

function CurrentPeriodCard({
  data,
  loading,
  error,
  onSubmit,
  submitPending,
  submitError,
}: {
  data: TimesheetViewDto | null;
  loading: boolean;
  error: boolean;
  onSubmit: (id: string) => void;
  submitPending: boolean;
  submitError: string | null;
}): JSX.Element {
  if (loading) return <CurrentPeriodSkeleton />;

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle aria-hidden />
        <AlertTitle>Gagal memuat timesheet</AlertTitle>
        <AlertDescription>Coba muat ulang halaman.</AlertDescription>
      </Alert>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-12">
          <CalendarClock className="h-8 w-8" aria-hidden />
          <p className="text-h6 text-foreground">Belum ada timesheet untuk periode ini</p>
          <p className="text-caption">Hubungi HR untuk generate timesheet periode berjalan.</p>
        </CardContent>
      </Card>
    );
  }

  const canSubmit = data.status === 'DRAFT' || data.status === 'REJECTED';
  const now = new Date();
  const periodEnded = new Date(data.periodEnd + 'T23:59:59Z') <= now;
  const submitDisabled = !canSubmit || !periodEnded || submitPending;
  const submitLabel = data.status === 'REJECTED' ? 'Ajukan ulang' : 'Submit untuk review';

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle id="ts-current-heading">Periode berjalan</CardTitle>
            <TimesheetStatusBadge status={data.status} />
          </div>
          <p className="text-muted-foreground text-caption">
            {data.periodLabel} ·{' '}
            <span className="tabular-nums">
              {data.periodStart} → {data.periodEnd}
            </span>
          </p>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {data.status === 'REJECTED' && data.rejectionReason ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden />
            <AlertTitle>Ditolak — silakan koreksi</AlertTitle>
            <AlertDescription>{data.rejectionReason}</AlertDescription>
          </Alert>
        ) : null}

        {canSubmit || data.status === 'PENDING_SUPERVISOR' || data.status === 'PENDING_HR' ? (
          <div className="flex flex-wrap items-center gap-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={submitDisabled} data-testid="ts-submit-button">
                  <Send className="h-4 w-4" aria-hidden />
                  {submitPending ? 'Mengirim…' : submitLabel}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Submit timesheet ke supervisor?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Timesheet akan dikunci dan dikirim untuk review. Anda hanya dapat mengeditnya
                    kembali bila supervisor menolak.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Batal</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => onSubmit(data.id)}
                    data-testid="ts-submit-confirm"
                  >
                    Ya, kirim untuk review
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {!periodEnded && canSubmit ? (
              <p className="text-muted-foreground text-caption">
                Periode masih berjalan — submit tersedia setelah tanggal akhir.
              </p>
            ) : null}
            {data.status === 'PENDING_SUPERVISOR' || data.status === 'PENDING_HR' ? (
              <p className="text-muted-foreground text-caption">
                Menunggu keputusan {data.status === 'PENDING_SUPERVISOR' ? 'supervisor' : 'HR'}.
              </p>
            ) : null}
          </div>
        ) : null}

        {submitError ? (
          <Alert variant="destructive" data-testid="ts-submit-error">
            <AlertTriangle aria-hidden />
            <AlertTitle>Gagal mengirim timesheet</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}

        <TotalsGrid totals={data.totals} />

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead>Jenis</TableHead>
                <TableHead className="text-right">Jam kerja</TableHead>
                <TableHead className="text-right">Lembur</TableHead>
                <TableHead className="text-right">Cuti</TableHead>
                <TableHead className="text-right">Telat</TableHead>
                <TableHead>Catatan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.entries.map((e) => (
                <TableRow key={e.workDate}>
                  <TableCell className="text-caption font-mono">{e.workDate}</TableCell>
                  <TableCell className={cn('text-body', KIND_TONE[e.kind])}>
                    {KIND_LABEL[e.kind]}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatHours(e.regularHours)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatHours(e.overtimeHours)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatHours(e.leaveHours)}
                  </TableCell>
                  <TableCell className="text-caption text-right font-mono tabular-nums">
                    {e.lateMinutes > 0 ? `${e.lateMinutes}m` : '-'}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-caption">
                    {e.note ?? '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function TotalsGrid({ totals }: { totals: TimesheetViewDto['totals'] }): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat label="Jam kerja" value={formatHours(totals.regularHours)} />
      <Stat label="Jam lembur" value={formatHours(totals.overtimeHours)} />
      <Stat label="Hari kerja" value={String(totals.workingDays)} />
      <Stat label="Hari cuti" value={String(totals.leaveDays)} />
      <Stat label="Hari absen" value={String(totals.absentDays)} />
      <Stat label="Hari libur" value={String(totals.holidays)} />
      <Stat label="Telat (menit)" value={String(totals.lateMinutes)} />
      <Stat label="Pulang cepat" value={String(totals.earlyLeaveMinutes)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="bg-muted/30 border-border rounded-md border p-3">
      <p className="text-muted-foreground text-overline uppercase">{label}</p>
      <p className="text-foreground text-h5 font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function PastPeriodsList({
  items,
  loading,
  error,
}: {
  items: TimesheetSummaryDto[];
  loading: boolean;
  error: boolean;
}): JSX.Element | null {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-md" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle aria-hidden />
        <AlertTitle>Gagal memuat riwayat periode</AlertTitle>
        <AlertDescription>Coba muat ulang halaman.</AlertDescription>
      </Alert>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-10">
          <Inbox className="h-6 w-6" aria-hidden />
          <p className="text-body text-foreground">Belum ada riwayat periode</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle id="ts-past-heading">Riwayat periode</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-border divide-y">
          {items.map((it) => (
            <li key={it.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="muted">{it.periodLabel}</Badge>
                  <TimesheetStatusBadge status={it.status} />
                </div>
                <p className="text-muted-foreground text-caption tabular-nums">
                  {it.periodStart} → {it.periodEnd}
                </p>
              </div>
              <div className="text-muted-foreground text-caption text-right">
                <p>
                  <span className="text-foreground font-medium tabular-nums">
                    {formatHours(it.totals.regularHours)}
                  </span>{' '}
                  jam reguler
                </p>
                <p>
                  <span className="text-foreground font-medium tabular-nums">
                    {formatHours(it.totals.overtimeHours)}
                  </span>{' '}
                  jam lembur
                </p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function CurrentPeriodSkeleton(): JSX.Element {
  return (
    <Card>
      <CardHeader className="space-y-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-48" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-9 w-40" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-md" />
          ))}
        </div>
        <Skeleton className="h-40 w-full rounded-md" />
      </CardContent>
    </Card>
  );
}

function formatHours(n: number): string {
  return n.toFixed(2);
}
