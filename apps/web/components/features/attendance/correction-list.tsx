'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AttendanceCorrection } from '@workpulse/shared-types';
import { AlertTriangle, Inbox, X } from 'lucide-react';
import { type JSX } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { ApiError, attendanceCorrectionsApi } from '@/lib/api-client';

/**
 * Employee's own corrections list. Latest 100. Cancel is available
 * on any `PENDING_APPROVAL` row (the API also enforces owner-only
 * and payroll cutoff).
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
      void qc.invalidateQueries({ queryKey: ['attendance', 'corrections', 'mine'] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Riwayat koreksi Anda</CardTitle>
        <p className="text-muted-foreground text-caption">
          100 pengajuan terbaru. Anda dapat membatalkan pengajuan yang masih menunggu keputusan.
        </p>
      </CardHeader>

      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tanggal</TableHead>
              <TableHead>Diminta</TableHead>
              <TableHead>Alasan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading ? (
              <RowsSkeleton />
            ) : list.isError ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="text-destructive py-6 text-center">
                  Gagal memuat riwayat koreksi.
                </TableCell>
              </TableRow>
            ) : (list.data ?? []).length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5}>
                  <div className="text-muted-foreground flex flex-col items-center gap-2 py-8">
                    <Inbox className="h-6 w-6" aria-hidden />
                    <p className="text-body">Belum ada koreksi yang diajukan.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              (list.data ?? []).map((r) => (
                <TableRow key={r.id} className="align-top">
                  <TableCell className="font-medium tabular-nums">
                    {formatDate(r.workDate)}
                  </TableCell>
                  <TableCell className="text-caption tabular-nums">{summarize(r)}</TableCell>
                  <TableCell className="text-muted-foreground text-caption max-w-xs truncate">
                    {r.reason}
                  </TableCell>
                  <TableCell>
                    <CorrectionStatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {r.status === 'PENDING_APPROVAL' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => cancel.mutate(r.id)}
                        disabled={cancel.isPending}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                        Batalkan
                      </Button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      {cancel.isError ? (
        <div className="px-6 pb-6">
          <Alert variant="destructive">
            <AlertTriangle aria-hidden />
            <AlertTitle>Gagal membatalkan</AlertTitle>
            <AlertDescription>{formatApiError(cancel.error)}</AlertDescription>
          </Alert>
        </div>
      ) : null}
    </Card>
  );
}

function RowsSkeleton(): JSX.Element {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <TableRow key={i} className="hover:bg-transparent">
          {Array.from({ length: 5 }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full max-w-[120px]" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------

export function CorrectionStatusBadge({
  status,
}: {
  status: AttendanceCorrection['status'];
}): JSX.Element {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    variant: 'muted' as const,
  };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

const STATUS_CONFIG: Record<
  AttendanceCorrection['status'],
  { label: string; variant: 'warning' | 'success' | 'destructive' | 'muted' }
> = {
  PENDING_APPROVAL: { label: 'Menunggu', variant: 'warning' },
  APPROVED: { label: 'Disetujui', variant: 'success' },
  REJECTED: { label: 'Ditolak', variant: 'destructive' },
  CANCELLED: { label: 'Dibatalkan', variant: 'muted' },
};

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

function formatApiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'PAYROLL_LOCKED') {
      return 'Periode payroll sudah ditutup — permintaan tidak dapat dibatalkan.';
    }
    return err.message ?? err.code;
  }
  return 'Terjadi kesalahan tak dikenal.';
}
