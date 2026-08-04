'use client';

import { useQuery } from '@tanstack/react-query';
import type { VendorCategory, VendorStatus, VendorSummaryDto } from '@workpulse/shared-types';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';

import type { ApiError} from '@/lib/api-client';
import { vendorProcessorApi } from '@/lib/api-client';

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
      <div className="border-border bg-card flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
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

      {query.isLoading && <p className="text-muted-foreground text-sm">Memuat…</p>}
      {query.isError && (
        <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          Gagal memuat: {(query.error as ApiError).message}
        </p>
      )}

      {query.data && query.data.items.length === 0 && (
        <div className="border-border bg-card text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
          Belum ada vendor / processor terdaftar untuk filter ini.
        </div>
      )}

      {query.data && query.data.items.length > 0 && (
        <div className="border-border bg-card overflow-hidden rounded-md border">
          <table className="divide-border min-w-full divide-y text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-left text-xs uppercase tracking-wide">
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
            <tbody className="divide-border divide-y">
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
          className="text-primary font-medium hover:underline"
        >
          {vendor.name}
        </Link>
        <div className="text-muted-foreground text-xs">{vendor.slug}</div>
      </td>
      <td className="text-muted-foreground px-3 py-2">{CATEGORY_LABEL[vendor.category]}</td>
      <td className="px-3 py-2">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[vendor.status]}`}
        >
          {STATUS_LABEL[vendor.status]}
        </span>
      </td>
      <td className="text-muted-foreground px-3 py-2">{VOLUME_LABEL[vendor.personalDataVolume]}</td>
      <td className="text-muted-foreground px-3 py-2">
        {vendor.dpaSignedAt ? (
          <span className="text-emerald-700 dark:text-emerald-300">Ditandatangani</span>
        ) : (
          <span className="text-amber-700 dark:text-amber-300">Belum</span>
        )}
      </td>
      <td className="text-muted-foreground px-3 py-2">{formatDate(vendor.nextReviewAt)}</td>
      <td className="text-muted-foreground px-3 py-2">
        {vendor.contractEndAt ? formatDate(vendor.contractEndAt) : '—'}
      </td>
      <td className="text-muted-foreground px-3 py-2">
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
    <label className="text-muted-foreground flex items-center gap-2 text-xs">
      <span className="uppercase tracking-wide">{label}</span>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value as T)}
        className="border-border bg-background text-foreground rounded-md border px-2 py-1 text-sm"
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
