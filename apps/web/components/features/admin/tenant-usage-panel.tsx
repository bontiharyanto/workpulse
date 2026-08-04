'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TenantUsageSnapshotDto } from '@workpulse/shared-types';
import React, { useMemo, useState } from 'react';

import { useAuth } from '@/components/providers/auth-provider';
import { ApiError, tenantUsageApi } from '@/lib/api-client';

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

function formatBytesString(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let idx = 0;
  let val = n;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  const digits = val >= 100 || idx === 0 ? 0 : val >= 10 ? 1 : 2;
  return `${val.toFixed(digits)} ${units[idx]}`;
}

function formatPeriod(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS_ID[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * OPS-7 — Tenant usage panel. Renders differently depending on the
 * caller's role:
 *
 *   - HR_MANAGER: per-tenant history (only their tenant).
 *   - SUPER_ADMIN: cross-tenant table + regenerate any month for any
 *     tenant.
 */
export function TenantUsagePanel(): JSX.Element {
  const { user } = useAuth();
  const isSuper = user?.role === 'SUPER_ADMIN';
  const qc = useQueryClient();

  const [companyFilter, setCompanyFilter] = useState<string>('');
  const listQuery = useQuery({
    queryKey: ['tenant-usage-list', companyFilter],
    queryFn: () =>
      tenantUsageApi.list({
        companyId: companyFilter || undefined,
        pageSize: 60,
      }),
  });

  const [regenYear, setRegenYear] = useState<string>(() =>
    String(new Date().getUTCFullYear()),
  );
  const [regenMonth, setRegenMonth] = useState<string>(() => {
    const now = new Date();
    const prev = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    return String(prev.getUTCMonth() + 1);
  });
  const [regenCompany, setRegenCompany] = useState<string>('');

  const regenMutation = useMutation({
    mutationFn: () =>
      tenantUsageApi.regenerate({
        companyId: regenCompany,
        year: Number(regenYear),
        month: Number(regenMonth),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['tenant-usage-list'] });
    },
  });

  const regenError = regenMutation.error
    ? regenMutation.error instanceof ApiError
      ? (regenMutation.error.message ?? 'Gagal menghasilkan ulang snapshot.')
      : 'Gagal menghasilkan ulang snapshot.'
    : null;

  const rows = listQuery.data?.rows ?? [];
  const groupedByCompany = useMemo(() => {
    const map = new Map<string, TenantUsageSnapshotDto[]>();
    for (const r of rows) {
      const arr = map.get(r.companyId) ?? [];
      arr.push(r);
      map.set(r.companyId, arr);
    }
    return map;
  }, [rows]);

  return (
    <div className="space-y-6">
      {isSuper && (
        <section
          aria-labelledby="regen-heading"
          className="space-y-3 rounded-lg border border-border bg-card p-4"
        >
          <div>
            <h2 id="regen-heading" className="text-sm font-semibold">
              Regenerate snapshot bulan tertentu (SUPER_ADMIN)
            </h2>
            <p className="text-xs text-muted-foreground">
              Menghitung ulang counter dari data mentah. Aman dijalankan
              kapan saja — tidak ada side-effect di data lain.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs text-muted-foreground">
              Tenant (companyId)
              <input
                type="text"
                value={regenCompany}
                onChange={(e) => setRegenCompany(e.target.value)}
                placeholder="cmp_xxx"
                className="mt-1 w-52 rounded border border-input bg-background px-2 py-1 text-sm text-foreground"
              />
            </label>
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
              disabled={
                regenMutation.isPending || regenCompany.trim().length === 0
              }
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
      )}

      {isSuper && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Filter tenant:</span>
          <input
            type="text"
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            placeholder="companyId (kosongkan untuk semua)"
            className="rounded border border-input bg-background px-2 py-1 text-xs"
          />
        </div>
      )}

      {listQuery.isLoading && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground"
        >
          Memuat snapshot penggunaan…
        </div>
      )}

      {listQuery.isError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"
        >
          Gagal memuat data.
        </div>
      )}

      {listQuery.data && rows.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Belum ada snapshot untuk filter ini. Snapshot bulanan otomatis dibuat
          pada tanggal 1 setiap bulan pukul 06:00 UTC.
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-6">
          {Array.from(groupedByCompany.entries()).map(([companyId, list]) => (
            <TenantBlock key={companyId} companyId={companyId} rows={list} />
          ))}
        </div>
      )}
    </div>
  );
}

function TenantBlock({
  companyId,
  rows,
}: {
  companyId: string;
  rows: TenantUsageSnapshotDto[];
}): JSX.Element {
  const sorted = [...rows].sort((a, b) =>
    b.periodStart.localeCompare(a.periodStart),
  );
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Tenant</h2>
          <code className="text-xs text-muted-foreground">{companyId}</code>
        </div>
        <div className="text-xs text-muted-foreground">
          {sorted.length} snapshot
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-2 py-2">Periode</th>
              <th className="px-2 py-2">Storage</th>
              <th className="px-2 py-2">DB rows (total)</th>
              <th className="px-2 py-2">Notif</th>
              <th className="px-2 py-2">Webhook</th>
              <th className="px-2 py-2">Active users</th>
              <th className="px-2 py-2">Total users</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.id}
                className="border-b border-border last:border-none"
              >
                <td className="px-2 py-2 font-medium">
                  {formatPeriod(row.periodStart)}
                </td>
                <td className="px-2 py-2">
                  <div className="tabular-nums">
                    {formatBytesString(row.storageTotalBytes)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    export {formatBytesString(row.storageExportBytes)} + DSAR{' '}
                    {formatBytesString(row.storageDsarBytes)}
                  </div>
                  {!row.attachmentBytesTracked && (
                    <div className="text-[10px] text-amber-600 dark:text-amber-400">
                      Lampiran belum di-track
                    </div>
                  )}
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {Number(row.dbRowsTotal).toLocaleString('id-ID')}
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {row.notificationsCreated.toLocaleString('id-ID')}
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {row.webhookDeliveries.toLocaleString('id-ID')}
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {row.activeUsers.toLocaleString('id-ID')}
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {row.totalUsers.toLocaleString('id-ID')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
