'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import {
  createVendorSchema,
  type CreateVendorInput,
  vendorCategorySchema,
  vendorDataVolumeSchema,
} from '@workpulse/shared-types';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';

import { ApiError, vendorProcessorApi } from '@/lib/api-client';

const ERROR_COPY: Record<string, string> = {
  VENDOR_SLUG_TAKEN: 'Slug ini sudah dipakai vendor lain di tenant.',
  VENDOR_CONTRACT_WINDOW_INVALID:
    'Tanggal berakhir kontrak harus setelah tanggal mulai.',
  THROTTLED: 'Terlalu banyak percobaan. Coba lagi sebentar.',
};

/** Create form — only the essential fields. Advanced fields (data
 * residency, subprocessors, certifications) live on the detail page
 * so this initial submit stays low-friction. */
export function VendorProcessorCreateForm() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateVendorInput>({
    resolver: zodResolver(createVendorSchema),
    defaultValues: {
      slug: '',
      name: '',
      category: 'OTHER',
      description: '',
      dataCategories: [],
      personalDataVolume: 'LOW',
      subprocessorsAllowed: false,
      securityCertifications: [],
    },
  });

  const create = useMutation({
    mutationFn: (input: CreateVendorInput) => vendorProcessorApi.create(input),
    onSuccess: (vendor) => {
      router.push(`/admin/privacy/vendors/${vendor.id}` as unknown as Route);
    },
  });

  const err = create.error as ApiError | null;

  return (
    <form
      onSubmit={handleSubmit((values) => create.mutate(values))}
      className="space-y-4 rounded-md border border-border bg-card p-6"
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field
          label="Nama vendor"
          hint="Nama resmi (mis. PT Payroll Nusantara, Amazon S3)."
          error={errors.name?.message}
        >
          <input
            {...register('name')}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="PT Payroll Nusantara"
          />
        </Field>
        <Field
          label="Slug"
          hint="kebab-case, unik per tenant (mis. payroll-nusantara)."
          error={errors.slug?.message}
        >
          <input
            {...register('slug')}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="payroll-nusantara"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Kategori">
          <select
            {...register('category')}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {vendorCategorySchema.options.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Volume data pribadi">
          <select
            {...register('personalDataVolume')}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {vendorDataVolumeSchema.options.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        label="Deskripsi"
        hint="Untuk apa vendor ini dipakai, data apa yang dikirim, dan pola aliran datanya."
        error={errors.description?.message}
      >
        <textarea
          {...register('description')}
          rows={4}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          placeholder="Payroll processor yang menerima gaji, PPh21, dan mutasi karyawan setiap tanggal 25 via SFTP…"
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field
          label="Kontak — Nama"
          error={errors.contactName?.message}
          optional
        >
          <input
            {...register('contactName')}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Andi Wijaya"
          />
        </Field>
        <Field
          label="Kontak — Email"
          error={errors.contactEmail?.message}
          optional
        >
          <input
            {...register('contactEmail')}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="dpo@vendor.co.id"
            type="email"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Kontrak mulai" optional>
          <input
            type="date"
            {...register('contractStartAt', {
              setValueAs: (v) => (v ? new Date(v).toISOString() : null),
            })}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Kontrak berakhir" optional>
          <input
            type="date"
            {...register('contractEndAt', {
              setValueAs: (v) => (v ? new Date(v).toISOString() : null),
            })}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
      </div>

      <Field
        label="DPA ditandatangani pada"
        hint="Wajib diisi sebelum status berubah ke ACTIVE."
        optional
      >
        <input
          type="date"
          {...register('dpaSignedAt', {
            setValueAs: (v) => (v ? new Date(v).toISOString() : null),
          })}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </Field>

      <Field label="Subprocessor diperbolehkan?" hint="Vendor boleh melibatkan pihak ketiga.">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            {...register('subprocessorsAllowed')}
            className="h-4 w-4 rounded border-border"
          />
          Ya
        </label>
      </Field>

      {err && (
        <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {ERROR_COPY[err.code ?? ''] ?? err.message}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Link
          href={'/admin/privacy/vendors' as unknown as Route}
          className="rounded-md border border-border bg-card px-3 py-2 text-sm hover:border-primary/60"
        >
          Batal
        </Link>
        <button
          type="submit"
          disabled={isSubmitting || create.isPending}
          className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isSubmitting || create.isPending ? 'Menyimpan…' : 'Simpan vendor'}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  error,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {optional && <span className="ml-1 normal-case text-muted-foreground/70">(opsional)</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>
      )}
    </div>
  );
}
