'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  RetentionAuditFinding,
  RetentionAuditReportDto,
} from '@workpulse/shared-types';
import Link from 'next/link';
import type { Route } from 'next';
import React from 'react';

import { retentionAuditApi } from '@/lib/api-client';

const SEVERITY_CLASSES: Record<
  RetentionAuditFinding['severity'],
  string
> = {
  info: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-500/20 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-500/30',
  warning:
    'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-500/40',
  critical:
    'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-500/30 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-500/40',
};

const MONTHS_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

function formatPeriod(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS_ID[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

interface Props {
  reportId: string;
}

/**
 * OPS-6 — Detail view. Renders every finding with severity + counter
 * side-by-side with the policy snapshot so a DPO can reason about
 * "gap-vs-policy" without cross-referencing the retention page.
 */
export function RetentionAuditReportDetail({ reportId }: Props): JSX.Element {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['retention-audit-detail', reportId],
    queryFn: () => retentionAuditApi.detail(reportId),
  });

  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground"
      >
        Memuat detail laporan…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"
      >
        Gagal memuat detail laporan.
        <div className="mt-2">
          <Link
            href={'/admin/privacy/retention/audit-reports' as unknown as Route}
            className="text-sm underline"
          >
            Kembali ke daftar
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ReportHeader row={data} />
      <ReportCounters row={data} />
      <FindingsList findings={data.findings} />
      <PolicySnapshot row={data} />
    </div>
  );
}

function ReportHeader({ row }: { row: RetentionAuditReportDto }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-xs text-muted-foreground">
          <Link
            href={'/admin/privacy/retention/audit-reports' as unknown as Route}
            className="hover:underline"
          >
            ← Retention Audit
          </Link>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {formatPeriod(row.periodStart)}
        </h1>
        <p className="text-sm text-muted-foreground">
          Dihasilkan {new Date(row.generatedAt).toLocaleString('id-ID')}
          {row.workerLastRunAt && (
            <>
              {' · '}Worker terakhir tick{' '}
              {new Date(row.workerLastRunAt).toLocaleString('id-ID')}
            </>
          )}
        </p>
      </div>
      <StatusBadge status={row.status} />
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: RetentionAuditReportDto['status'];
}): JSX.Element {
  const label =
    status === 'SUCCESS'
      ? 'Bersih'
      : status === 'GAP_DETECTED'
        ? 'Ada gap'
        : 'Worker tidak berjalan';
  const cls =
    status === 'SUCCESS'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300'
      : status === 'GAP_DETECTED'
        ? 'bg-amber-50 text-amber-800 ring-amber-600/30 dark:bg-amber-950/40 dark:text-amber-200'
        : 'bg-rose-50 text-rose-700 ring-rose-600/30 dark:bg-rose-950/40 dark:text-rose-300';
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${cls}`}
    >
      {label}
    </span>
  );
}

function ReportCounters({
  row,
}: {
  row: RetentionAuditReportDto;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">Aktivitas worker</h2>
      <dl className="grid grid-cols-3 gap-4 text-sm">
        <Cell label="Notifikasi dihapus" value={row.notificationsPruned} />
        <Cell label="User auto-anonimisasi" value={row.usersAutoAnonymised} />
        <Cell label="DSAR archive expired" value={row.dsarArchivesExpired} />
      </dl>
      <h2 className="mb-3 mt-6 text-sm font-semibold">Gap yang tersisa</h2>
      <dl className="grid grid-cols-3 gap-4 text-sm">
        <Cell
          label="Notifikasi past-retention"
          value={row.notificationsPastRetention}
          highlight={row.notificationsPastRetention > 0}
        />
        <Cell
          label="DSAR archive past-retention"
          value={row.dsarArchivesPastRetention}
          highlight={row.dsarArchivesPastRetention > 0}
        />
        <Cell
          label="Terminated user past-retention"
          value={row.terminatedUsersPastRetention}
          highlight={row.terminatedUsersPastRetention > 0}
        />
      </dl>
    </section>
  );
}

function Cell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}): JSX.Element {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`mt-0.5 text-lg font-semibold tabular-nums ${
          highlight ? 'text-amber-600 dark:text-amber-400' : ''
        }`}
      >
        {value.toLocaleString('id-ID')}
      </dd>
    </div>
  );
}

function FindingsList({
  findings,
}: {
  findings: RetentionAuditFinding[];
}): JSX.Element {
  if (findings.length === 0) {
    return (
      <section className="rounded-lg border border-emerald-500/20 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-200">
        Tidak ada temuan pada periode ini. RetentionWorker menjalankan semua
        pruning sesuai kebijakan.
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">
        {findings.length} temuan aktif
      </h2>
      <ul className="space-y-3">
        {findings.map((f) => (
          <li
            key={f.kind}
            className="flex items-start gap-3 rounded-md border border-border bg-background p-3"
          >
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                SEVERITY_CLASSES[f.severity]
              }`}
            >
              {f.severity}
            </span>
            <div className="flex-1 space-y-1 text-sm">
              <div className="font-medium">{humanKind(f.kind)}</div>
              <div className="text-muted-foreground">{f.message}</div>
            </div>
            {typeof f.count === 'number' && (
              <span className="text-sm tabular-nums text-foreground">
                {f.count.toLocaleString('id-ID')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function humanKind(kind: RetentionAuditFinding['kind']): string {
  switch (kind) {
    case 'notifications_past_retention':
      return 'Notifikasi melewati batas retensi';
    case 'dsar_archives_past_retention':
      return 'DSAR archive melewati batas retensi';
    case 'terminated_users_past_retention':
      return 'User terminated melewati batas anonimisasi';
    case 'worker_inactive_during_period':
      return 'RetentionWorker tidak berjalan';
    default:
      return kind;
  }
}

function PolicySnapshot({
  row,
}: {
  row: RetentionAuditReportDto;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">
        Snapshot kebijakan saat laporan dibuat
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Nilai-nilai kebijakan pada saat audit dibuat, dibekukan supaya
        regenerate berikutnya reproducible walau kebijakan berubah.
      </p>
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        <Cell
          label="Retensi notifikasi (hari)"
          value={row.policySnapshot.notificationRetentionDays}
        />
        <Cell
          label="Retensi DSAR archive (jam)"
          value={row.policySnapshot.dataExportArchiveRetentionHours}
        />
        <Cell
          label="Anonimisasi post-terminate (hari)"
          value={row.policySnapshot.terminatedUserAnonymizeDays}
        />
      </dl>
    </section>
  );
}
