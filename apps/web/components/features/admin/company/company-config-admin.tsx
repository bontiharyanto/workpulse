'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CompanyConfig, CompanyConfigUpdateInput } from '@workpulse/shared-types';

import { ApiError, companyAdminApi } from '@/lib/api-client';

import { CompanyConfigForm } from './company-config-form';

const ERROR_COPY: Record<string, string> = {
  INVALID_TIMEZONE: 'Timezone tidak dikenali. Gunakan format IANA seperti Asia/Jakarta.',
  EMPTY_UPDATE: 'Tidak ada perubahan yang dikirim.',
  COMPANY_NOT_FOUND: 'Data perusahaan tidak ditemukan.',
};

export function CompanyConfigAdmin(): JSX.Element {
  const qc = useQueryClient();
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [formVersion, setFormVersion] = useState(0);

  const query = useQuery({
    queryKey: ['admin', 'company'],
    queryFn: () => companyAdminApi.get(),
  });

  const update = useMutation({
    mutationFn: (patch: CompanyConfigUpdateInput) => companyAdminApi.update(patch),
    onSuccess: (fresh: CompanyConfig) => {
      qc.setQueryData(['admin', 'company'], fresh);
      setFormVersion((v) => v + 1);
      setFlash({ kind: 'ok', text: 'Konfigurasi tersimpan.' });
    },
    onError: (err) => {
      let text = 'Gagal menyimpan konfigurasi.';
      if (err instanceof ApiError) {
        text = ERROR_COPY[err.code ?? ''] ?? err.message ?? text;
      }
      setFlash({ kind: 'err', text });
    },
  });

  if (query.isLoading) {
    return (
      <div className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
        Memuat konfigurasi…
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
      >
        Gagal memuat konfigurasi. Coba muat ulang halaman.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {flash && (
        <div
          role={flash.kind === 'err' ? 'alert' : 'status'}
          className={
            flash.kind === 'ok'
              ? 'rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-300'
              : 'rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive'
          }
        >
          {flash.text}
        </div>
      )}

      {/*
       * Remount the form after a successful save so that RHF's defaultValues
       * refresh to the persisted server state (rather than keeping the
       * previous initial snapshot). `formVersion` is incremented on save.
       */}
      <CompanyConfigForm
        key={`v${formVersion}`}
        initial={query.data}
        submitting={update.isPending}
        onSubmit={async (patch) => {
          setFlash(null);
          if (Object.keys(patch).length === 0) {
            setFlash({ kind: 'err', text: 'Tidak ada perubahan yang perlu disimpan.' });
            return;
          }
          await update.mutateAsync(patch);
        }}
      />
    </div>
  );
}
