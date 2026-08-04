'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { VendorCategory, VendorDetailDto, VendorStatus } from '@workpulse/shared-types';
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

const ERROR_COPY: Record<string, string> = {
  VENDOR_TERMINATED: 'Vendor sudah di-terminasi, tidak dapat diubah lagi.',
  VENDOR_ALREADY_TERMINATED: 'Vendor sudah di-terminasi.',
  VENDOR_DPA_REQUIRED: 'DPA harus ditandatangani sebelum vendor dapat aktif.',
  VENDOR_ILLEGAL_TRANSITION: 'Transisi status tidak diperbolehkan.',
  VENDOR_CONTRACT_WINDOW_INVALID: 'Tanggal berakhir kontrak harus setelah tanggal mulai.',
  VENDOR_ROPA_LINK_EXISTS: 'Vendor sudah tertaut dengan aktivitas ROPA ini.',
};

export function VendorProcessorDetail({ vendorId }: { vendorId: string }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['admin-vendor', vendorId],
    queryFn: () => vendorProcessorApi.detail(vendorId),
  });

  const markReviewed = useMutation({
    mutationFn: (note: string) => vendorProcessorApi.markReviewed(vendorId, { note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-vendor', vendorId] }),
  });

  const terminate = useMutation({
    mutationFn: (reason: string) => vendorProcessorApi.terminate(vendorId, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-vendor', vendorId] }),
  });

  const activate = useMutation({
    mutationFn: () => vendorProcessorApi.update(vendorId, { status: 'ACTIVE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-vendor', vendorId] }),
  });

  const deprecate = useMutation({
    mutationFn: () => vendorProcessorApi.update(vendorId, { status: 'DEPRECATED' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-vendor', vendorId] }),
  });

  if (query.isLoading) return <p className="text-muted-foreground text-sm">Memuat…</p>;
  if (query.isError)
    return (
      <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
        Gagal memuat: {(query.error as ApiError).message}
      </p>
    );
  if (!query.data) return null;

  const vendor = query.data;
  const isTerminated = vendor.status === 'TERMINATED';
  const mutationError =
    (markReviewed.error as ApiError | null) ??
    (terminate.error as ApiError | null) ??
    (activate.error as ApiError | null) ??
    (deprecate.error as ApiError | null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link
            href={'/admin/privacy/vendors' as unknown as Route}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            ← Kembali ke register
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {vendor.name}
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[vendor.status]}`}
            >
              {STATUS_LABEL[vendor.status]}
            </span>
          </h1>
          <p className="text-muted-foreground text-xs">
            {CATEGORY_LABEL[vendor.category]} · slug: <code>{vendor.slug}</code>
          </p>
        </div>
      </div>

      {mutationError && (
        <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {ERROR_COPY[mutationError.code ?? ''] ?? mutationError.message}
        </p>
      )}

      <VendorActionBar
        vendor={vendor}
        isTerminated={isTerminated}
        onMarkReviewed={(note) => markReviewed.mutate(note)}
        onActivate={() => activate.mutate()}
        onDeprecate={() => deprecate.mutate()}
        onTerminate={(reason) => terminate.mutate(reason)}
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Data yang diproses">
          <Row label="Volume" value={vendor.personalDataVolume} />
          <Row
            label="Kategori data"
            value={vendor.dataCategories.length > 0 ? vendor.dataCategories.join(', ') : '—'}
          />
          <Row label="Data residency" value={vendor.dataResidency ?? '—'} />
        </Card>

        <Card title="Kontrak & DPA">
          <Row
            label="Kontrak mulai"
            value={vendor.contractStartAt ? formatDate(vendor.contractStartAt) : '—'}
          />
          <Row
            label="Kontrak berakhir"
            value={vendor.contractEndAt ? formatDate(vendor.contractEndAt) : '—'}
          />
          <Row
            label="DPA ditandatangani"
            value={vendor.dpaSignedAt ? formatDate(vendor.dpaSignedAt) : 'Belum'}
          />
          <Row
            label="Subprocessor"
            value={vendor.subprocessorsAllowed ? 'Diizinkan' : 'Tidak diizinkan'}
          />
          <Row
            label="Sertifikasi"
            value={
              vendor.securityCertifications.length > 0
                ? vendor.securityCertifications.join(', ')
                : '—'
            }
          />
          {vendor.contractDocumentUrl && (
            <Row
              label="Dokumen"
              value={
                <a
                  href={vendor.contractDocumentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  Buka dokumen
                </a>
              }
            />
          )}
        </Card>

        <Card title="Kontak vendor">
          <Row label="Nama" value={vendor.contactName ?? '—'} />
          <Row label="Email" value={vendor.contactEmail ?? '—'} />
          <Row label="Telepon" value={vendor.contactPhone ?? '—'} />
        </Card>

        <Card title="Siklus review">
          <Row label="Next review" value={formatDate(vendor.nextReviewAt)} />
          <Row
            label="Terakhir direview"
            value={vendor.lastReviewedAt ? formatDate(vendor.lastReviewedAt) : '—'}
          />
          <Row label="Catatan review terakhir" value={vendor.lastReviewNote ?? '—'} />
        </Card>
      </section>

      <section className="border-border bg-card rounded-md border p-4">
        <h2 className="mb-2 text-sm font-medium">Deskripsi & konteks</h2>
        <p className="text-muted-foreground whitespace-pre-wrap text-sm">{vendor.description}</p>
      </section>

      <section className="border-border bg-card rounded-md border p-4">
        <h2 className="mb-2 text-sm font-medium">
          ROPA activities yang tertaut ({vendor.ropaLinks.length})
        </h2>
        {vendor.ropaLinks.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Belum ada tautan ke ROPA activity. Tautkan dari halaman ROPA activity untuk melengkapi
            register.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {vendor.ropaLinks.map((link) => (
              <li key={link.id} className="border-border bg-background rounded-md border p-3">
                <div className="font-medium">{link.ropaActivityName ?? link.ropaActivitySlug}</div>
                <div className="text-muted-foreground text-xs">
                  Slug: <code>{link.ropaActivitySlug}</code>
                </div>
                {link.note && <p className="text-muted-foreground mt-1 text-xs">{link.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isTerminated && (
        <section className="rounded-md border border-rose-500/40 bg-rose-50 p-4 dark:bg-rose-950/30">
          <h2 className="mb-2 text-sm font-medium text-rose-700 dark:text-rose-300">
            Vendor sudah di-terminasi
          </h2>
          <p className="text-sm text-rose-700 dark:text-rose-300">
            Terminasi pada {vendor.terminatedAt ? formatDate(vendor.terminatedAt) : '—'}. Alasan:{' '}
            {vendor.terminatedReason ?? '—'}.
          </p>
        </section>
      )}
    </div>
  );
}

function VendorActionBar({
  vendor,
  isTerminated,
  onMarkReviewed,
  onActivate,
  onDeprecate,
  onTerminate,
}: {
  vendor: VendorDetailDto;
  isTerminated: boolean;
  onMarkReviewed: (note: string) => void;
  onActivate: () => void;
  onDeprecate: () => void;
  onTerminate: (reason: string) => void;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [terminateReason, setTerminateReason] = useState('');

  if (isTerminated) return null;

  return (
    <section className="border-border bg-card flex flex-wrap gap-2 rounded-md border p-3">
      <button
        type="button"
        onClick={() => setReviewOpen((v) => !v)}
        className="border-border bg-background hover:border-primary/60 rounded-md border px-3 py-1.5 text-sm"
      >
        Mark reviewed
      </button>
      {vendor.status === 'UNDER_REVIEW' && (
        <button
          type="button"
          onClick={onActivate}
          disabled={!vendor.dpaSignedAt}
          title={!vendor.dpaSignedAt ? 'DPA harus ditandatangani dulu' : ''}
          className="border-border rounded-md border bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700 hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          Aktifkan
        </button>
      )}
      {vendor.status === 'ACTIVE' && (
        <button
          type="button"
          onClick={onDeprecate}
          className="border-border rounded-md border bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:border-slate-500 dark:bg-slate-800/60 dark:text-slate-200"
        >
          Tandai deprecated
        </button>
      )}
      <button
        type="button"
        onClick={() => setTerminateOpen((v) => !v)}
        className="ml-auto rounded-md border border-rose-500/40 bg-rose-50 px-3 py-1.5 text-sm text-rose-700 hover:border-rose-500 dark:bg-rose-950/40 dark:text-rose-300"
      >
        Terminasi
      </button>

      {reviewOpen && (
        <div className="border-border bg-background w-full rounded-md border p-3">
          <label className="text-muted-foreground mb-1 block text-xs uppercase tracking-wide">
            Catatan review (opsional)
          </label>
          <textarea
            rows={3}
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            className="border-border bg-background w-full rounded-md border px-3 py-2 text-sm"
            placeholder="SOC2 renewed 2026-05, subprocessor list unchanged."
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setReviewOpen(false)}
              className="border-border rounded-md border px-3 py-1.5 text-sm"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={() => {
                onMarkReviewed(reviewNote.trim());
                setReviewOpen(false);
                setReviewNote('');
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-sm"
            >
              Simpan review
            </button>
          </div>
        </div>
      )}

      {terminateOpen && (
        <div className="w-full rounded-md border border-rose-500/40 bg-rose-50/70 p-3 dark:bg-rose-950/30">
          <label className="mb-1 block text-xs uppercase tracking-wide text-rose-700 dark:text-rose-300">
            Alasan terminasi (wajib, min. 5 karakter)
          </label>
          <textarea
            rows={3}
            value={terminateReason}
            onChange={(e) => setTerminateReason(e.target.value)}
            className="border-border bg-background w-full rounded-md border px-3 py-2 text-sm"
            placeholder="Kontrak tidak diperpanjang, data telah dihapus per email …"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setTerminateOpen(false)}
              className="border-border rounded-md border px-3 py-1.5 text-sm"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={() => {
                if (terminateReason.trim().length < 5) return;
                onTerminate(terminateReason.trim());
                setTerminateOpen(false);
                setTerminateReason('');
              }}
              disabled={terminateReason.trim().length < 5}
              className="rounded-md bg-rose-600 px-3 py-1.5 text-sm text-white hover:bg-rose-700 disabled:opacity-50"
            >
              Terminasi vendor
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-border bg-card rounded-md border p-4">
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      <dl className="space-y-1 text-sm">{children}</dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">{label}</dt>
      <dd className="text-foreground col-span-2 text-sm">{value}</dd>
    </div>
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
