'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type {
  TimesheetStatus,
  TimesheetSummaryDto,
  TimesheetViewDto,
} from '@workpulse/shared-types';

import { timesheetSelfApi } from '@/lib/api-client';

const KIND_LABEL: Record<TimesheetViewDto['entries'][number]['kind'], string> = {
  WORKING: 'Kerja',
  HOLIDAY: 'Libur nasional',
  WEEKEND: 'Akhir pekan',
  LEAVE: 'Cuti',
  ABSENT: 'Absen',
};

const KIND_TONE: Record<TimesheetViewDto['entries'][number]['kind'], string> = {
  WORKING: 'text-foreground',
  HOLIDAY: 'text-amber-600',
  WEEKEND: 'text-muted-foreground',
  LEAVE: 'text-blue-600',
  ABSENT: 'text-destructive',
};

/**
 * `/me/timesheet` main widget (Fase 32a). Shows the current-period
 * timesheet grid + totals + a short list of past periods. Everything
 * server-materialised — the FE never re-aggregates.
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
  if (loading) {
    return (
      <div className="border-border text-muted-foreground rounded-md border border-dashed p-6 text-sm">
        Memuat timesheet periode berjalan…
      </div>
    );
  }
  if (error) {
    return (
      <div
        role="alert"
        className="border-destructive/50 bg-destructive/5 text-destructive rounded-md border p-4 text-sm"
      >
        Gagal memuat timesheet.
      </div>
    );
  }
  if (!data) {
    return (
      <div className="border-border text-muted-foreground rounded-md border border-dashed p-6 text-sm">
        Belum ada timesheet untuk periode ini. Hubungi HR untuk generate timesheet periode berjalan.
      </div>
    );
  }

  const canSubmit = data.status === 'DRAFT' || data.status === 'REJECTED';
  const now = new Date();
  const periodEnded = new Date(data.periodEnd + 'T23:59:59Z') <= now;
  const submitDisabled = !canSubmit || !periodEnded || submitPending;
  const [confirming, setConfirming] = useState(false);
  const handleSubmitClick = (): void => {
    if (confirming) {
      onSubmit(data.id);
      setConfirming(false);
    } else {
      setConfirming(true);
    }
  };

  return (
    <section
      aria-labelledby="ts-current-heading"
      className="border-border bg-card rounded-lg border p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="ts-current-heading" className="text-lg font-semibold">
            Periode berjalan
          </h2>
          <StatusBadge status={data.status} />
        </div>
        <p className="text-muted-foreground text-sm">
          {data.periodLabel} · {data.periodStart} → {data.periodEnd}
        </p>
      </div>

      {data.status === 'REJECTED' && data.rejectionReason && (
        <div
          role="alert"
          className="border-destructive/50 bg-destructive/5 text-destructive mt-3 rounded-md border p-3 text-sm"
        >
          <div className="font-medium">Ditolak — silakan koreksi</div>
          <div className="mt-1 text-xs">{data.rejectionReason}</div>
        </div>
      )}

      {(canSubmit || data.status === 'PENDING_SUPERVISOR' || data.status === 'PENDING_HR') && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSubmitClick}
            disabled={submitDisabled}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center rounded-md px-4 py-2 text-sm font-medium shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="ts-submit-button"
          >
            {submitPending
              ? 'Mengirim…'
              : confirming
                ? 'Klik lagi untuk konfirmasi'
                : data.status === 'REJECTED'
                  ? 'Ajukan ulang'
                  : 'Submit untuk review'}
          </button>
          {!periodEnded && canSubmit && (
            <p className="text-muted-foreground text-xs">
              Periode masih berjalan — submit tersedia setelah tanggal akhir.
            </p>
          )}
          {(data.status === 'PENDING_SUPERVISOR' || data.status === 'PENDING_HR') && (
            <p className="text-muted-foreground text-xs">
              Menunggu keputusan {data.status === 'PENDING_SUPERVISOR' ? 'supervisor' : 'HR'}.
            </p>
          )}
        </div>
      )}
      {submitError && (
        <p role="alert" className="text-destructive mt-2 text-xs" data-testid="ts-submit-error">
          {submitError}
        </p>
      )}

      <TotalsGrid totals={data.totals} />

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-xs uppercase">
              <th className="px-3 py-2 text-left">Tanggal</th>
              <th className="px-3 py-2 text-left">Jenis</th>
              <th className="px-3 py-2 text-right">Jam kerja</th>
              <th className="px-3 py-2 text-right">Lembur</th>
              <th className="px-3 py-2 text-right">Cuti</th>
              <th className="px-3 py-2 text-right">Telat</th>
              <th className="px-3 py-2 text-left">Catatan</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((e) => (
              <tr key={e.workDate} className="border-b last:border-b-0">
                <td className="px-3 py-2 font-mono text-xs">{e.workDate}</td>
                <td className={`px-3 py-2 ${KIND_TONE[e.kind]}`}>{KIND_LABEL[e.kind]}</td>
                <td className="px-3 py-2 text-right font-mono">{formatHours(e.regularHours)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatHours(e.overtimeHours)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatHours(e.leaveHours)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {e.lateMinutes > 0 ? `${e.lateMinutes}m` : '-'}
                </td>
                <td className="text-muted-foreground px-3 py-2 text-xs">{e.note ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TotalsGrid({ totals }: { totals: TimesheetViewDto['totals'] }): JSX.Element {
  return (
    <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
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
    <div className="border-border bg-background rounded-md border p-3">
      <div className="text-muted-foreground text-xs uppercase">{label}</div>
      <div className="mt-1 text-base font-semibold">{value}</div>
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
  if (loading) return null;
  if (error) return null;
  if (items.length === 0) return null;

  return (
    <section
      aria-labelledby="ts-past-heading"
      className="border-border bg-card rounded-lg border p-6"
    >
      <h2 id="ts-past-heading" className="mb-3 text-lg font-semibold">
        Riwayat periode
      </h2>
      <ul className="divide-border divide-y">
        {items.map((it) => (
          <li key={it.id} className="flex items-center justify-between py-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                {it.periodLabel}
                <StatusBadge status={it.status} />
              </div>
              <div className="text-muted-foreground text-xs">
                {it.periodStart} → {it.periodEnd}
              </div>
            </div>
            <div className="text-muted-foreground text-right text-xs">
              <div>{formatHours(it.totals.regularHours)}h reguler</div>
              <div>{formatHours(it.totals.overtimeHours)}h lembur</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const STATUS_LABEL: Record<TimesheetStatus, string> = {
  DRAFT: 'Draft',
  PENDING_SUPERVISOR: 'Menunggu supervisor',
  PENDING_HR: 'Menunggu HR',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
};

const STATUS_TONE: Record<TimesheetStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  PENDING_SUPERVISOR: 'bg-blue-100 text-blue-900',
  PENDING_HR: 'bg-blue-100 text-blue-900',
  APPROVED: 'bg-emerald-100 text-emerald-900',
  REJECTED: 'bg-destructive/10 text-destructive',
};

export function StatusBadge({ status }: { status: TimesheetStatus }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}
      data-testid="ts-status-badge"
      data-status={status}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function formatHours(n: number): string {
  return n.toFixed(2);
}
