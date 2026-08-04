'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  CompanyDashboardSnapshot,
  DepartmentDashboardSnapshot,
} from '@workpulse/shared-types';
import { RefreshCw } from 'lucide-react';
import { useState, type JSX, type ReactNode } from 'react';

import { DistributionBar, DonutChart } from '@/components/charts';
import { CountUp } from '@/components/motion/motion-primitives';
import { useAuth } from '@/components/providers/auth-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { attendanceApi } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * Company-wide attendance snapshot. Renders:
 *   1. A date picker and a subtle "syncing" indicator.
 *   2. Six statistic cards (total, clocked-in, absent, on-leave,
 *      not-clocked-in, late) with animated count-up numbers.
 *   3. A distribution bar (attendance status split for the day) +
 *      an on-time ratio donut side-by-side.
 *   4. A per-department breakdown table.
 *
 * Refreshes every 60s on the assumption HR keeps the tab open all
 * morning. Access control is server-side; the component returns
 * `null` for non-HR / non-Super Admin users so the shell doesn't
 * leave a gap.
 */
export function CompanyDashboard(): JSX.Element | null {
  const { user } = useAuth();
  const [date, setDate] = useState<string>(() => toIsoDate(new Date()));

  const canView = !!user && (user.role === 'HR_MANAGER' || user.role === 'SUPER_ADMIN');

  const q = useQuery({
    queryKey: ['attendance', 'dashboard', date],
    queryFn: () => attendanceApi.dashboard({ date }),
    enabled: canView,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });

  if (!canView) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="company-dashboard-date" className="text-muted-foreground text-caption">
            Tanggal
          </Label>
          <Input
            id="company-dashboard-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-auto"
          />
        </div>
        {q.isFetching ? (
          <span className="text-muted-foreground text-caption inline-flex items-center gap-1.5">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Memperbarui…
          </span>
        ) : null}
      </div>

      {q.isLoading ? (
        <DashboardSkeleton />
      ) : q.isError ? (
        <Card>
          <CardContent className="text-destructive text-body py-6">
            Gagal memuat rekap. Coba muat ulang halaman.
          </CardContent>
        </Card>
      ) : q.data ? (
        <>
          <StatGrid snapshot={q.data} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <StatusDistributionCard snapshot={q.data} />
            <OnTimeCard snapshot={q.data} />
          </div>

          <DepartmentTable rows={q.data.departments} />
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function StatGrid({ snapshot }: { snapshot: CompanyDashboardSnapshot }): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <StatCard label="Total karyawan" value={snapshot.total} />
      <StatCard label="Sudah clock-in" value={snapshot.clockedIn} tone="success" />
      <StatCard
        label="Absen"
        value={snapshot.absent}
        tone={snapshot.absent > 0 ? 'destructive' : 'muted'}
      />
      <StatCard label="Cuti / izin" value={snapshot.onLeave} tone="info" />
      <StatCard
        label="Belum clock-in"
        value={snapshot.notClockedIn}
        tone={snapshot.notClockedIn > 0 ? 'warning' : 'muted'}
      />
      <StatCard
        label="Terlambat"
        value={snapshot.lateToday}
        tone={snapshot.lateToday > 0 ? 'warning' : 'muted'}
      />
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: number;
  tone?: 'success' | 'warning' | 'destructive' | 'info' | 'muted';
}

function StatCard({ label, value, tone = 'muted' }: StatCardProps): JSX.Element {
  const valueClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'destructive'
          ? 'text-destructive'
          : tone === 'info'
            ? 'text-info'
            : 'text-foreground';
  return (
    <Card className="p-4">
      <p className="text-muted-foreground text-overline uppercase">{label}</p>
      <p className={cn('text-h2 mt-1 tabular-nums', valueClass)}>
        <CountUp value={value} duration={0.6} format={(n) => n.toFixed(0)} />
      </p>
    </Card>
  );
}

function StatusDistributionCard({ snapshot }: { snapshot: CompanyDashboardSnapshot }): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sebaran status hari ini</CardTitle>
        <p className="text-muted-foreground text-caption">
          Distribusi <span className="tabular-nums">{snapshot.total}</span> karyawan berdasarkan
          status kehadiran.
        </p>
      </CardHeader>
      <CardContent>
        <DistributionBar
          total={snapshot.total}
          segments={[
            {
              key: 'clocked-in',
              label: 'Sudah clock-in',
              value: snapshot.clockedIn,
              color: 'success',
            },
            {
              key: 'on-leave',
              label: 'Cuti / izin',
              value: snapshot.onLeave,
              color: 'info',
            },
            {
              key: 'not-clocked-in',
              label: 'Belum clock-in',
              value: snapshot.notClockedIn,
              color: 'warning',
            },
            {
              key: 'absent',
              label: 'Absen',
              value: snapshot.absent,
              color: 'destructive',
            },
          ]}
          ariaLabel="Distribusi status kehadiran"
        />
      </CardContent>
    </Card>
  );
}

function OnTimeCard({ snapshot }: { snapshot: CompanyDashboardSnapshot }): JSX.Element {
  const rate = snapshot.onTimeRatePercent;
  const onTimeCount =
    snapshot.clockedIn - snapshot.lateToday > 0 ? snapshot.clockedIn - snapshot.lateToday : 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tingkat ketepatan waktu</CardTitle>
        <p className="text-muted-foreground text-caption">
          Persentase karyawan yang clock-in tepat waktu di antara mereka yang sudah masuk.
        </p>
      </CardHeader>
      <CardContent>
        {rate === null || snapshot.clockedIn === 0 ? (
          <div className="text-muted-foreground text-body flex h-[180px] items-center justify-center">
            Belum ada karyawan yang clock-in.
          </div>
        ) : (
          <DonutChart
            height={180}
            centerValue={`${rate.toFixed(1)}%`}
            centerLabel="tepat waktu"
            data={[
              { key: 'ontime', label: 'Tepat waktu', value: onTimeCount, color: 'success' },
              { key: 'late', label: 'Terlambat', value: snapshot.lateToday, color: 'warning' },
              {
                key: 'early',
                label: 'Pulang cepat',
                value: snapshot.earlyLeaveToday,
                color: 'destructive',
              },
            ]}
            ariaLabel="Grafik distribusi ketepatan waktu"
          />
        )}
      </CardContent>
    </Card>
  );
}

function DepartmentTable({ rows }: { rows: DepartmentDashboardSnapshot[] }): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Breakdown per departemen</CardTitle>
        <p className="text-muted-foreground text-caption">
          Rekap kehadiran per departemen untuk tanggal yang dipilih.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Departemen</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Clock-in</TableHead>
              <TableHead className="text-right">Absen</TableHead>
              <TableHead className="text-right">Cuti</TableHead>
              <TableHead className="text-right">Belum</TableHead>
              <TableHead className="text-right">Terlambat</TableHead>
              <TableHead className="text-right">On-time %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="text-muted-foreground text-body py-6 text-center">
                  Tidak ada departemen dengan karyawan aktif.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.departmentId ?? '(unassigned)'}>
                  <TableCell className="font-medium">
                    {r.departmentName ?? '(Tanpa departemen)'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.total}</TableCell>
                  <TableCell className="text-success text-right tabular-nums">
                    {r.clockedIn}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.absent > 0 ? (
                      <span className="text-destructive font-medium">{r.absent}</span>
                    ) : (
                      r.absent
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right tabular-nums">
                    {r.onLeave}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.notClockedIn > 0 ? (
                      <span className="text-warning font-medium">{r.notClockedIn}</span>
                    ) : (
                      r.notClockedIn
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.lateToday > 0 ? (
                      <span className="text-warning font-medium">{r.lateToday}</span>
                    ) : (
                      r.lateToday
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    <OnTimeRateBadge rate={r.onTimeRatePercent} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function OnTimeRateBadge({ rate }: { rate: number | null }): ReactNode {
  if (rate === null) return <span className="text-muted-foreground">—</span>;
  const cls = rate >= 90 ? 'text-success' : rate >= 75 ? 'text-warning' : 'text-destructive';
  return <span className={cls}>{rate.toFixed(1)}%</span>;
}

function DashboardSkeleton(): JSX.Element {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="mb-2 h-3 w-20" />
            <Skeleton className="h-7 w-12" />
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-64" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-6 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-64" />
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            <Skeleton className="h-[180px] w-[180px] rounded-full" />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
