'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  RetentionAuditReportDto,
  RetentionAuditStatus,
} from '@workpulse/shared-types';
import Link from 'next/link';
import type { Route } from 'next';
import React, { useState } from 'react';

import { ApiError, retentionAuditApi } from '@/lib/api-client';

const STATUS_LABEL: Record<RetentionAuditStatus, string> = {
  SUCCESS: 'Bersih',
  GAP_DETECTED: 'Ada gap',
  WORKER_INACTIVE: 'Worker tidak berjalan',
};

const STATUS_CLASSES: Record<RetentionAuditStatus, string> = {
  SUCCESS:
    'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-500/40',
  GAP_DETECTED:
    'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/30 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-500/40',
  WORKER_INACTIVE:
    'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/30 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-500/40',
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

/**
 * OPS-6 — Retention audit report list panel.
 *
 * Renders each historical report as a timeline card with a status
 * chip + counters row. HR / Super Admin can also manually regenerate
 * a specific month (typically after a policy fix).
 */
export function RetentionAuditReportsPanel(): JSX.Element {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<RetentionAuditStatus | 'ALL'>(
    'ALL',
  );

  const { data, isLoading, isError } = useQuery({
    queryKey: ['retention-audit-list', statusFilter],
    queryFn: () =>
      retentionAuditApi.list({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        pageSize: 24,
      }),
  });

  const [regenYear, setRegenYear] = useState<string>(() =>
    String(new Date().getUTCFullYear()),
  );
  const [regenMonth, setRegenMonth] = useState<string>(() => {
    const now = new Date();
    // Default to previous month.
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return String(prev.getUTCMonth() + 1);
  });
  const regenMutation = useMutation({
    mutationFn: () =>
      retentionAuditApi.regenerate({
        year: Number(regenYear),
        month: Number(regenMonth),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['retention-audit-list'] });
    },
  });

  const regenError = regenMutation.error
    ? regenMutation.error instanceof ApiError
      ? (regenMutation.error.message ?? 'Gagal menghasilkan ulang laporan.')
      : 'Gagal menghasilkan ulang laporan.'
    : null;

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="regen-heading"
        className="space-y-3 rounded-lg border border-border bg-card p-4"
      >
        <div>
          <h2 id="regen-heading" className="text-sm font-semibold">
            Regenerate laporan bulan tertentu
          </h2>
          <p className="text-xs text-muted-foreground">
            Gunakan setelah kebijakan retensi diubah atau post-mortem worker.
            Kembali menghitung dari data mentah — tidak menimbulkan side-effect
            di data lain.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs text-muted-foreground">
            Tahun
            <input
              type="number"
              min={2000}
              max={2100}
              value={regenYear}
              onChange={(e) => setRegenYear(e.target.value)}
              className="mt-1 w-24 rounded border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </label>
          <label className="flex flex-col text-xs text-muted-foreground">
            Bulan
            <select
              value={regenMonth}
              onChange={(e) => setRegenMonth(e.target.value)}
              className="mt-1 w-40 rounded border border-input bg-background px-2 py-1 text-sm text-foreground"
            >
              {MONTHS_ID.map((label, i) => (
                <option key={label} value={i + 1}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => regenMutation.mutate()}
            disabled={regenMutation.isPending}
            className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {regenMutation.isPending ? 'Menghasilkan…' : 'Regenerate'}
          </button>
          {regenMutation.isSuccess && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">
              Selesai.
            </span>
          )}
          {regenError && (
            <span role="alert" className="text-xs text-destructive">
              {regenError}
            </span>
          )}
        </div>
      </section>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Filter status:</span>
        {(
          [
            { id: 'ALL', label: 'Semua' },
            { id: 'SUCCESS', label: 'Bersih' },
            { id: 'GAP_DETECTED', label: 'Ada gap' },
            { id: 'WORKER_INACTIVE', label: 'Worker tidak berjalan' },
          ] as const
        ).map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setStatusFilter(opt.id)}
            className={`rounded-full px-3 py-1 text-xs ${
              statusFilter === opt.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-foreground/70 hover:bg-muted/80'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground"
        >
          Memuat laporan audit…
        </div>
      )}

      {isError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"
        >
          Gagal memuat laporan. Coba muat ulang halaman.
        </div>
      )}

      {data && data.rows.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Belum ada laporan bulanan untuk filter ini.
        </div>
      )}

      {data && data.rows.length > 0 && (
        <ol className="space-y-3" aria-label="Timeline laporan audit retention">
          {data.rows.map((row) => (
            <li key={row.id}>
              <ReportCard row={row} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ReportCard({ row }: { row: RetentionAuditReportDto }): JSX.Element {
  const findingCount = row.findings.length;
  return (
    <Link
      href={
        `/admin/privacy/retention/audit-reports/${row.id}` as unknown as Route
      }
      className="block rounded-lg border border-border bg-card p-4 transition hover:border-primary/60"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{formatPeriod(row.periodStart)}</div>
          <div className="text-xs text-muted-foreground">
            Dihasilkan {new Date(row.generatedAt).toLocaleString('id-ID')}
          </div>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            STATUS_CLASSES[row.status]
          }`}
        >
          {STATUS_LABEL[row.status]}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3 text-xs">
        <MetricCell label="Notifikasi dihapus" value={row.notificationsPruned} />
        <MetricCell
          label="User auto-anonimisasi"
          value={row.usersAutoAnonymised}
        />
        <MetricCell label="DSAR archive expired" value={row.dsarArchivesExpired} />
      </dl>
      {findingCount > 0 && (
        <div className="mt-3 text-xs text-amber-700 dark:text-amber-300">
          {findingCount} temuan aktif — buka detail.
        </div>
      )}
    </Link>
  );
}

function MetricCell({
  label,
  value,
}: {
  label: string;
  value: number;
}): JSX.Element {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium tabular-nums">
        {value.toLocaleString('id-ID')}
      </dd>
    </div>
  );
}
