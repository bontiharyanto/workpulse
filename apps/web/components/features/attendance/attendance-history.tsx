'use client';

import { useQuery } from '@tanstack/react-query';
import type { AttendanceStatus } from '@workpulse/shared-types';
import { CalendarRange, Inbox } from 'lucide-react';
import { useMemo, useState, type JSX } from 'react';

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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { attendanceApi } from '@/lib/api-client';

import { StatusBadge } from './_shared/status-badge';

/**
 * Employee-facing attendance history — ranged filter (30/60/90d),
 * one row per work-day. Server bounds the max range to 365d and
 * clamps limit to 200; this component intentionally only offers
 * 3 presets to keep the mental model tight. A "year view" would
 * belong to a separate reports surface.
 */
type RangePreset = '30' | '60' | '90';

export function AttendanceHistory(): JSX.Element {
  const [preset, setPreset] = useState<RangePreset>('30');

  const { from, to } = useMemo(() => rangeFor(preset), [preset]);

  const list = useQuery({
    queryKey: ['attendance', 'history', from, to],
    queryFn: () => attendanceApi.history({ from, to, limit: 200 }),
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-4">
        <div className="space-y-1">
          <CardTitle>Riwayat kehadiran</CardTitle>
          <p className="text-muted-foreground text-caption inline-flex items-center gap-1.5">
            <CalendarRange className="h-3.5 w-3.5" aria-hidden />
            {formatRange(from, to)}
          </p>
        </div>
        <Tabs value={preset} onValueChange={(v) => setPreset(v as RangePreset)}>
          <TabsList>
            <TabsTrigger value="30">30 hari</TabsTrigger>
            <TabsTrigger value="60">60 hari</TabsTrigger>
            <TabsTrigger value="90">90 hari</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>

      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tanggal</TableHead>
              <TableHead>Clock-in</TableHead>
              <TableHead>Clock-out</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Telat</TableHead>
              <TableHead className="text-right">Cepat</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading ? (
              <HistoryRowsSkeleton />
            ) : list.data && list.data.length > 0 ? (
              list.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium tabular-nums">
                    {formatDate(r.workDate)}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatTime(r.clockInAt)}</TableCell>
                  <TableCell className="tabular-nums">
                    {r.clockOutAt ? formatTime(r.clockOutAt) : <MutedDash />}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status as AttendanceStatus} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.lateMinutes > 0 ? (
                      <span className="text-warning font-medium">{r.lateMinutes}m</span>
                    ) : (
                      <MutedDash />
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.earlyLeaveMinutes > 0 ? (
                      <span className="text-warning font-medium">{r.earlyLeaveMinutes}m</span>
                    ) : (
                      <MutedDash />
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="text-center">
                  <EmptyRow />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function HistoryRowsSkeleton(): JSX.Element {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <TableRow key={i} className="hover:bg-transparent">
          {Array.from({ length: 6 }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full max-w-[80px]" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function EmptyRow(): JSX.Element {
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-2 py-8">
      <Inbox className="h-6 w-6" aria-hidden />
      <p className="text-body">Tidak ada catatan kehadiran pada rentang ini.</p>
    </div>
  );
}

function rangeFor(preset: RangePreset): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - Number(preset) + 1);
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

function formatRange(from: string, to: string): string {
  const fromLabel = new Date(from).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const toLabel = new Date(to).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${fromLabel} — ${toLabel}`;
}

function MutedDash(): JSX.Element {
  return <span className="text-muted-foreground">—</span>;
}
