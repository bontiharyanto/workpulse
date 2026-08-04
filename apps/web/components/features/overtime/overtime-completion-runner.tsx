'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/components/providers/auth-provider';
import { ApiError, overtimeApi, type OvertimeCompletionRunResult } from '@/lib/api-client';

/**
 * Manual trigger for the daily overtime completion scheduler. Rendered only
 * for HR_MANAGER / SUPER_ADMIN. The cron itself runs at 02:00 server time
 * every day; this button gives HR an escape hatch (e.g. after backfilling
 * attendance manually).
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
    <section className="rounded-lg border border-dashed p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h3 className="text-sm font-semibold">Penyelesaian Otomatis (Scheduler)</h3>
          <p className="text-xs text-muted-foreground">
            Scheduler harian akan mempromote pengajuan lembur berstatus{' '}
            <span className="font-medium">Disetujui</span> menjadi{' '}
            <span className="font-medium">Selesai</span> setelah masa tenggang lewat dan
            kehadiran pada tanggal tersebut terverifikasi (clock-in &amp; clock-out lengkap).
            Klik tombol di samping untuk menjalankannya sekarang — cocok setelah menambahkan
            timesheet manual atau backfill kehadiran.
          </p>
        </div>
        <button
          type="button"
          disabled={run.isPending}
          onClick={() => run.mutate()}
          className="whitespace-nowrap rounded-md bg-foreground px-3 py-2 text-xs font-medium text-background shadow disabled:opacity-50"
        >
          {run.isPending ? 'Menjalankan…' : 'Jalankan sekarang'}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {lastResult && (
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
          <Metric label="Diperiksa" value={lastResult.scanned} />
          <Metric label="Diselesaikan" value={lastResult.completed} />
          <Metric label="Durasi" value={`${lastResult.durationMs} ms`} />
          <SkippedMetric skipped={lastResult.skipped} />
        </dl>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <div className="rounded-md border bg-muted/40 px-3 py-2">
      <dt className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
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
    return <Metric label="Dilewati" value="—" />;
  }
  return (
    <div className="rounded-md border bg-muted/40 px-3 py-2 sm:col-span-1">
      <dt className="text-[10px] uppercase tracking-widest text-muted-foreground">Dilewati</dt>
      <dd className="mt-1 space-y-0.5">
        {entries.map(([reason, count]) => (
          <div key={reason} className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{SKIP_LABEL[reason] ?? reason}</span>
            <span className="font-medium tabular-nums">{count}</span>
          </div>
        ))}
      </dd>
    </div>
  );
}
