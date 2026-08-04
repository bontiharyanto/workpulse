'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  retentionBounds,
  updateRetentionPolicyInputSchema,
  type UpdateRetentionPolicyInput,
} from '@workpulse/shared-types';
import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import { ApiError, retentionApi } from '@/lib/api-client';

const ERROR_COPY: Record<string, string> = {
  RETENTION_OUT_OF_BOUNDS: 'Salah satu nilai berada di luar batas yang diizinkan.',
  THROTTLED: 'Terlalu banyak percobaan. Coba lagi sebentar.',
};

/**
 * `/admin/privacy/retention` panel (Fase 31c). HR / Super Admin only.
 * The form mirrors the tenant `RetentionPolicy` row — three integer
 * fields with per-field ranges enforced client-side (via Zod) and
 * server-side (via `RetentionService.validate`).
 */
export function RetentionPolicyPanel(): JSX.Element {
  const qc = useQueryClient();
  const [saved, setSaved] = useState<'idle' | 'saved'>('idle');

  const policy = useQuery({
    queryKey: ['retention-policy'],
    queryFn: () => retentionApi.get(),
    staleTime: 60_000,
  });

  const form = useForm<UpdateRetentionPolicyInput>({
    resolver: zodResolver(updateRetentionPolicyInputSchema),
    defaultValues: {
      notificationRetentionDays: retentionBounds.notification.min,
      dataExportArchiveRetentionHours: retentionBounds.dataExport.min,
      terminatedUserAnonymizeDays: retentionBounds.terminatedUser.min,
    },
  });

  useEffect(() => {
    if (!policy.data) return;
    form.reset({
      notificationRetentionDays: policy.data.notificationRetentionDays,
      dataExportArchiveRetentionHours: policy.data.dataExportArchiveRetentionHours,
      terminatedUserAnonymizeDays: policy.data.terminatedUserAnonymizeDays,
    });
  }, [policy.data, form]);

  const mutation = useMutation({
    mutationFn: (input: UpdateRetentionPolicyInput) => retentionApi.update(input),
    onSuccess: async () => {
      setSaved('saved');
      await qc.invalidateQueries({ queryKey: ['retention-policy'] });
      window.setTimeout(() => setSaved('idle'), 3_000);
    },
  });

  const inlineError = mutation.error
    ? mutation.error instanceof ApiError
      ? (ERROR_COPY[mutation.error.code] ?? mutation.error.message)
      : 'Terjadi kesalahan saat menyimpan.'
    : null;

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate(values);
  });

  if (policy.isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="border-border text-muted-foreground rounded-md border border-dashed p-6 text-sm"
      >
        Memuat konfigurasi retensi…
      </div>
    );
  }

  if (policy.isError || !policy.data) {
    return (
      <div
        role="alert"
        className="border-destructive/50 bg-destructive/5 text-destructive rounded-md border p-4 text-sm"
      >
        Gagal memuat konfigurasi. Coba muat ulang halaman.
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="border-border bg-card space-y-6 rounded-lg border p-6"
      aria-labelledby="retention-heading"
    >
      <div className="space-y-1">
        <h2 id="retention-heading" className="text-lg font-semibold">
          Kebijakan retensi data
        </h2>
        <p className="text-muted-foreground text-sm">
          Perubahan berlaku pada job retensi harian berikutnya (02:00 UTC). Nilai <code>0</code>{' '}
          pada notifikasi atau auto-anonimisasi berarti fitur tersebut dinonaktifkan.
        </p>
      </div>

      <div className="space-y-4">
        <NumberField
          id="notificationRetentionDays"
          label="Retensi notifikasi (hari)"
          hint={`Notifikasi di atas ${retentionBounds.notification.min}–${retentionBounds.notification.max} hari akan dihapus job harian. 0 = simpan selamanya.`}
          min={retentionBounds.notification.min}
          max={retentionBounds.notification.max}
          error={form.formState.errors.notificationRetentionDays?.message}
          {...form.register('notificationRetentionDays', {
            valueAsNumber: true,
          })}
        />
        <NumberField
          id="dataExportArchiveRetentionHours"
          label="Retensi arsip DSAR (jam)"
          hint={`Arsip export data pengguna akan otomatis dihapus setelah interval ini. Range ${retentionBounds.dataExport.min}–${retentionBounds.dataExport.max} jam.`}
          min={retentionBounds.dataExport.min}
          max={retentionBounds.dataExport.max}
          error={form.formState.errors.dataExportArchiveRetentionHours?.message}
          {...form.register('dataExportArchiveRetentionHours', {
            valueAsNumber: true,
          })}
        />
        <NumberField
          id="terminatedUserAnonymizeDays"
          label="Auto-anonimisasi user berhenti bekerja (hari)"
          hint={`User dengan status TERMINATED akan diproses right-to-erasure otomatis setelah N hari. 0 = nonaktif. Range ${retentionBounds.terminatedUser.min}–${retentionBounds.terminatedUser.max}.`}
          min={retentionBounds.terminatedUser.min}
          max={retentionBounds.terminatedUser.max}
          error={form.formState.errors.terminatedUserAnonymizeDays?.message}
          {...form.register('terminatedUserAnonymizeDays', {
            valueAsNumber: true,
          })}
        />
      </div>

      {inlineError ? (
        <div
          role="alert"
          className="border-destructive/50 bg-destructive/5 text-destructive rounded-md border p-3 text-sm"
        >
          {inlineError}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p role="status" aria-live="polite" className="text-muted-foreground text-xs">
          {saved === 'saved' ? 'Perubahan tersimpan.' : ''}
        </p>
        <button
          type="submit"
          disabled={mutation.isPending || !form.formState.isDirty}
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center rounded-md px-4 py-2 text-sm font-medium shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending ? 'Menyimpan…' : 'Simpan kebijakan'}
        </button>
      </div>
    </form>
  );
}

interface NumberFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  id: string;
  label: string;
  hint: string;
  error?: string;
}

const NumberField = React.forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  { id, label, hint, error, ...rest },
  ref,
): JSX.Element {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-foreground text-sm font-medium">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        type="number"
        className="border-input bg-background focus:border-primary focus:ring-primary block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1"
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
        {...rest}
      />
      <p id={`${id}-hint`} className="text-muted-foreground text-xs">
        {hint}
      </p>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
});
