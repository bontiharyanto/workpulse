'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  VendorCategory,
  VendorStatus,
  VendorSummaryDto,
} from '@workpulse/shared-types';
import Link from 'next/link';
import type { Route } from 'next';
import { useState } from 'react';

import { ApiError, vendorProcessorApi } from '@/lib/api-client';

const STATUS_LABEL: Record<VendorStatus, string> = {
  UNDER_REVIEW: 'Under review',
  ACTIVE: 'Active',
  DEPRECATED: 'Deprecated',
  TERMINATED: 'Terminated',
};

const STATUS_CLASSES: Record<VendorStatus, string> = {
  UNDER_REVIEW:
    'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/30 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-500/40',
  ACTIVE:
    'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-500/40',
  DEPRECATED:
    'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/30 dark:bg-slate-800/60 dark:text-slate-200 dark:ring-slate-500/40',
  TERMINATED:
    'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/30 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-500/40',
};

const CATEGORY_LABEL: Record<VendorCategory, string> = {
  PAYROLL: 'Payroll',
  STORAGE: 'Storage',
  EMAIL: 'Email',
  MONITORING: 'Monitoring',
  PAYMENT: 'Payment',
  HR_SUITE: 'HR suite',
  COMMUNICATION: 'Komunikasi',
  OTHER: 'Lainnya',
};

const VOLUME_LABEL: Record<string, string> = {
  LOW: 'Rendah',
  MEDIUM: 'Sedang',
  HIGH: 'Tinggi',
  MASSIVE: 'Masif',
};

/**
 * Client component — read-only list of vendor / processor rows with
 * simple filter chips. Rows link to `/admin/privacy/vendors/[id]`.
 */
export function VendorProcessorList() {
  const [status, setStatus] = useState<VendorStatus | 'ALL'>('ALL');
  const [category, setCategory] = useState<VendorCategory | 'ALL'>('ALL');

  const query = useQuery({
    queryKey: ['admin-vendors', status, category],
    queryFn: () =>
      vendorProcessorApi.list({
        status: status === 'ALL' ? undefined : status,
        category: category === 'ALL' ? undefined : category,
        limit: 100,
      }),
  });

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3 text-sm">
        <FilterGroup
          label="Status"
          value={status}
          setValue={(v) => setStatus(v as VendorStatus | 'ALL')}
          options={[
            ['ALL', 'Semua'],
            ...(Object.keys(STATUS_LABEL) as VendorStatus[]).map(
              (k) => [k, STATUS_LABEL[k]] as const,
            ),
          ]}
        />
        <FilterGroup
          label="Kategori"
          value={category}
          setValue={(v) => setCategory(v as VendorCategory | 'ALL')}
          options={[
            ['ALL', 'Semua'],
            ...(Object.keys(CATEGORY_LABEL) as VendorCategory[]).map(
              (k) => [k, CATEGORY_LABEL[k]] as const,
            ),
          ]}
        />
      </div>

      {query.isLoading && <p className="text-sm text-muted-foreground">Memuat…</p>}
      {query.isError && (
        <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          Gagal memuat: {(query.error as ApiError).message}
        </p>
      )}

      {query.data && query.data.items.length === 0 && (
        <div className="rounded-md border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Belum ada vendor / processor terdaftar untuk filter ini.
        </div>
      )}

      {query.data && query.data.items.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Nama</th>
                <th className="px-3 py-2 font-medium">Kategori</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Volume</th>
                <th className="px-3 py-2 font-medium">DPA</th>
                <th className="px-3 py-2 font-medium">Next review</th>
                <th className="px-3 py-2 font-medium">Kontrak berakhir</th>
                <th className="px-3 py-2 font-medium">ROPA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.data.items.map((v: VendorSummaryDto) => (
                <VendorRow key={v.id} vendor={v} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function VendorRow({ vendor }: { vendor: VendorSummaryDto }) {
  return (
    <tr className="hover:bg-muted/30">
      <td className="px-3 py-2">
        <Link
          href={`/admin/privacy/vendors/${vendor.id}` as unknown as Route}
          className="font-medium text-primary hover:underline"
        >
          {vendor.name}
        </Link>
        <div className="text-xs text-muted-foreground">{vendor.slug}</div>
      </td>
      <td className="px-3 py-2 text-muted-foreground">
        {CATEGORY_LABEL[vendor.category]}
      </td>
      <td className="px-3 py-2">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[vendor.status]}`}
        >
          {STATUS_LABEL[vendor.status]}
        </span>
      </td>
      <td className="px-3 py-2 text-muted-foreground">
        {VOLUME_LABEL[vendor.personalDataVolume]}
      </td>
      <td className="px-3 py-2 text-muted-foreground">
        {vendor.dpaSignedAt ? (
          <span className="text-emerald-700 dark:text-emerald-300">
            Ditandatangani
          </span>
        ) : (
          <span className="text-amber-700 dark:text-amber-300">Belum</span>
        )}
      </td>
      <td className="px-3 py-2 text-muted-foreground">
        {formatDate(vendor.nextReviewAt)}
      </td>
      <td className="px-3 py-2 text-muted-foreground">
        {vendor.contractEndAt ? formatDate(vendor.contractEndAt) : '—'}
      </td>
      <td className="px-3 py-2 text-muted-foreground">
        {vendor.linkedRopaCount > 0 ? (
          <span>{vendor.linkedRopaCount} tautan</span>
        ) : (
          <span className="text-muted-foreground/70">—</span>
        )}
      </td>
    </tr>
  );
}

function FilterGroup<T extends string>({
  label,
  value,
  setValue,
  options,
}: {
  label: string;
  value: T;
  setValue: (v: T) => void;
  options: ReadonlyArray<readonly [T, string]>;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="uppercase tracking-wide">{label}</span>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value as T)}
        className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
      >
        {options.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}
