'use client';

import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Play, Search, SkipForward } from 'lucide-react';
import { useState, type JSX } from 'react';

import { useAuth } from '@/components/providers/auth-provider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError, overtimeApi, type OvertimeCompletionRunResult } from '@/lib/api-client';

/**
 * Manual trigger for the daily overtime completion scheduler. Rendered
 * only for HR_MANAGER / SUPER_ADMIN. The cron itself runs at 02:00
 * server time every day; this button gives HR an escape hatch (e.g.
 * after backfilling attendance manually).
 *
 * INVARIANT (rules/20 §3): the FE role check is UX only — the API
 * endpoint `/admin/overtime/run-completion` enforces the same role.
 */
export function OvertimeCompletionRunner(): JSX.Element | null {
  const { user } = useAuth();
  const [lastResult, setLastResult] = useState<OvertimeCompletionRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: () => overtimeApi.runCompletion(),
    onSuccess: (result) => {
      setError(null);
      setLastResult(result);
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(err.message);
      else setError('Gagal menjalankan penyelesaian.');
    },
  });

  if (!user || (user.role !== 'HR_MANAGER' && user.role !== 'SUPER_ADMIN')) {
    return null;
  }

  return (
    <Card className="border-dashed">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="max-w-xl">
          <CardTitle className="text-h6">Penyelesaian otomatis (scheduler)</CardTitle>
          <p className="text-muted-foreground text-caption mt-1">
            Promote pengajuan berstatus <b>Disetujui</b> → <b>Selesai</b> setelah masa tenggang
            lewat dan kehadiran pada tanggal tersebut terverifikasi. Cocok setelah backfill
            manual.
          </p>
        </div>
        <Button size="sm" disabled={run.isPending} onClick={() => run.mutate()}>
          <Play className="h-4 w-4" aria-hidden />
          {run.isPending ? 'Menjalankan…' : 'Jalankan sekarang'}
        </Button>
      </CardHeader>

      {(error || lastResult) && (
        <CardContent className="space-y-3">
          {error ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden />
              <AlertTitle>Gagal menjalankan penyelesaian</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {lastResult ? (
            <div className="grid gap-3 sm:grid-cols-4">
              <Metric
                icon={<Search className="h-3.5 w-3.5" aria-hidden />}
                label="Diperiksa"
                value={lastResult.scanned}
              />
              <Metric
                icon={<CheckCircle2 className="text-success h-3.5 w-3.5" aria-hidden />}
                label="Diselesaikan"
                value={lastResult.completed}
                tone="success"
              />
              <Metric
                icon={<Clock className="h-3.5 w-3.5" aria-hidden />}
                label="Durasi"
                value={`${lastResult.durationMs} ms`}
              />
              <SkippedMetric skipped={lastResult.skipped} />
            </div>
          ) : null}
        </CardContent>
      )}
    </Card>
  );
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  tone?: 'success';
}): JSX.Element {
  return (
    <div className="bg-muted/30 border-border rounded-md border p-3">
      <div className="text-muted-foreground text-overline inline-flex items-center gap-1.5 uppercase">
        {icon}
        {label}
      </div>
      <p
        className={
          tone === 'success'
            ? 'text-success text-h5 tabular-nums font-semibold'
            : 'text-foreground text-h5 tabular-nums font-semibold'
        }
      >
        {value}
      </p>
    </div>
  );
}

const SKIP_LABEL: Record<string, string> = {
  ALREADY_COMPLETED: 'Sudah selesai',
  NOT_APPROVED: 'Belum disetujui',
  GRACE_NOT_MET: 'Belum lewat tenggang',
  NO_ATTENDANCE: 'Tanpa kehadiran',
  INCOMPLETE_ATTENDANCE: 'Kehadiran tidak lengkap',
  PROMOTE_FAILED: 'Gagal update',
};

function SkippedMetric({ skipped }: { skipped: Record<string, number> }): JSX.Element {
  const entries = Object.entries(skipped);
  if (entries.length === 0) {
    return (
      <Metric
        icon={<SkipForward className="h-3.5 w-3.5" aria-hidden />}
        label="Dilewati"
        value="—"
      />
    );
  }
  return (
    <div className="bg-muted/30 border-border rounded-md border p-3">
      <div className="text-muted-foreground text-overline inline-flex items-center gap-1.5 uppercase">
        <SkipForward className="h-3.5 w-3.5" aria-hidden />
        Dilewati
      </div>
      <dl className="mt-1.5 space-y-0.5 text-caption">
        {entries.map(([reason, count]) => (
          <div key={reason} className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">{SKIP_LABEL[reason] ?? reason}</dt>
            <dd className="text-foreground font-medium tabular-nums">{count}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
