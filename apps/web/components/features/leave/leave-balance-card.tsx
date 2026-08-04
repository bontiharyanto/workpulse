'use client';

import { useQuery } from '@tanstack/react-query';
import type { LeaveBalance } from '@workpulse/shared-types';
import { CalendarClock, Info, RotateCcw, Umbrella, Wallet } from 'lucide-react';
import { type JSX } from 'react';

import { CountUp } from '@/components/motion/motion-primitives';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { leaveApi } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * Leave balance overview — one Card per leave type. Renders a big
 * `remaining` number (with CountUp animation on mount), a progress
 * bar tinted by threshold, and a 3-cell breakdown of used /
 * reserved / carry-over.
 *
 * INVARIANT (per rules/20 §2): balance numbers are ALWAYS server-
 * computed. We never derive `remaining` from `quota - used` — the
 * server decrements inside a `prisma.$transaction` with row-level
 * locking, and any FE math races with concurrent approvals.
 */
export function LeaveBalanceCard(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['leave', 'balance'],
    queryFn: () => leaveApi.balance(),
  });

  if (isLoading) return <BalanceSkeleton />;

  if (error) {
    return (
      <Alert variant="destructive">
        <Info aria-hidden />
        <AlertTitle>Gagal memuat saldo cuti</AlertTitle>
        <AlertDescription>Coba muat ulang halaman.</AlertDescription>
      </Alert>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Alert variant="info">
        <Info aria-hidden />
        <AlertTitle>Belum ada saldo cuti tahun ini</AlertTitle>
        <AlertDescription>
          Pengajuan pertama akan otomatis membuat baris saldo untuk tipe cuti tersebut.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {data.map((b) => (
        <BalanceTile key={b.leaveTypeId} balance={b} />
      ))}
    </div>
  );
}

function BalanceTile({ balance: b }: { balance: LeaveBalance }): JSX.Element {
  const total = b.quota + b.carriedOver;
  const usedAndReserved = b.used + b.reserved;
  const consumedPct = total > 0 ? Math.min(100, (usedAndReserved / total) * 100) : 0;
  const remainingPct = 100 - consumedPct;
  const tone =
    remainingPct >= 40 ? 'success' : remainingPct >= 15 ? 'warning' : 'destructive';

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="bg-primary/10 text-primary rounded-md p-1.5">
              <Umbrella className="h-4 w-4" aria-hidden />
            </div>
            <CardTitle className="text-h5">{b.leaveTypeName}</CardTitle>
          </div>
          <Badge variant="muted" className="tabular-nums">
            {b.year}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div>
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                'text-display-sm tabular-nums font-semibold',
                tone === 'success'
                  ? 'text-foreground'
                  : tone === 'warning'
                    ? 'text-warning'
                    : 'text-destructive',
              )}
            >
              <CountUp value={b.remaining} duration={0.7} format={(n) => n.toFixed(0)} />
            </span>
            <span className="text-muted-foreground text-body">
              hari dari <span className="tabular-nums">{total}</span>
            </span>
          </div>
          <div className="mt-3">
            <Progress value={remainingPct} tone={tone} aria-label="Sisa saldo cuti" />
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-3 text-caption">
          <BreakdownCell
            icon={<Wallet className="h-3.5 w-3.5" aria-hidden />}
            label="Terpakai"
            value={b.used}
          />
          <BreakdownCell
            icon={<CalendarClock className="h-3.5 w-3.5" aria-hidden />}
            label="Reservasi"
            value={b.reserved}
            tone="warning"
          />
          <BreakdownCell
            icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}
            label="Carry-over"
            value={b.carriedOver}
          />
        </dl>
      </CardContent>
    </Card>
  );
}

function BreakdownCell({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: 'warning';
}): JSX.Element {
  return (
    <div>
      <dt className="text-muted-foreground inline-flex items-center gap-1">
        {icon}
        {label}
      </dt>
      <dd
        className={cn(
          'text-h6 tabular-nums',
          tone === 'warning' ? 'text-warning' : 'text-foreground',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function BalanceSkeleton(): JSX.Element {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {Array.from({ length: 2 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-12" />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-2 w-full" />
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((__, j) => (
                <div key={j} className="space-y-1">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-5 w-8" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
