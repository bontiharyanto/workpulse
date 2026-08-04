'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { publishPolicyInputSchema, type PublishPolicyInput } from '@workpulse/shared-types';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { ApiError, privacyPolicyAdminApi } from '@/lib/api-client';

const ERROR_COPY: Record<string, string> = {
  POLICY_VERSION_DUPLICATE: 'Versi ini sudah pernah diterbitkan. Gunakan label yang lain.',
  THROTTLED: 'Terlalu banyak percobaan. Coba lagi sebentar.',
};

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
};

/**
 * Fase 31c admin panel: list every privacy-policy version the tenant
 * has published, and expose a "publish new version" form. Publishing a
 * new version resets every user's consent state — the next `GET
 * /auth/me` returns `pendingConsent`, forcing a `/consent` redirect.
 */
export function PrivacyPoliciesPanel(): JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const list = useQuery({
    queryKey: ['privacy-policies'],
    queryFn: () => privacyPolicyAdminApi.list(),
    staleTime: 10_000,
  });

  const form = useForm<PublishPolicyInput>({
    resolver: zodResolver(publishPolicyInputSchema),
    defaultValues: { version: '', title: '', body: '' },
  });

  const publishMutation = useMutation({
    mutationFn: (input: PublishPolicyInput) => privacyPolicyAdminApi.publish(input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['privacy-policies'] });
      form.reset({ version: '', title: '', body: '' });
      setShowForm(false);
    },
  });

  const inlineError = publishMutation.error
    ? publishMutation.error instanceof ApiError
      ? (ERROR_COPY[publishMutation.error.code] ?? publishMutation.error.message)
      : 'Terjadi kesalahan saat menerbitkan.'
    : null;

  const onSubmit = form.handleSubmit((values) => {
    publishMutation.mutate(values);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Versi kebijakan</h2>
          <p className="text-muted-foreground text-sm">
            Setiap versi memiliki label unik. Menerbitkan versi baru akan meminta seluruh pengguna
            menerima ulang saat login berikutnya.
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center rounded-md px-4 py-2 text-sm font-medium shadow-sm"
          >
            Terbitkan versi baru
          </button>
        )}
      </div>

      {showForm && (
        <form
          onSubmit={onSubmit}
          className="border-border bg-card space-y-4 rounded-lg border p-6"
          aria-labelledby="publish-heading"
        >
          <h3 id="publish-heading" className="text-base font-medium">
            Terbitkan versi baru
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="policy-version" className="text-sm font-medium">
                Label versi
              </label>
              <input
                id="policy-version"
                type="text"
                placeholder="misal: 2026-08"
                className="border-input bg-background block w-full rounded-md border px-3 py-2 text-sm"
                aria-invalid={form.formState.errors.version ? 'true' : 'false'}
                {...form.register('version')}
              />
              {form.formState.errors.version && (
                <p role="alert" className="text-destructive text-xs">
                  {form.formState.errors.version.message}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <label htmlFor="policy-title" className="text-sm font-medium">
                Judul
              </label>
              <input
                id="policy-title"
                type="text"
                className="border-input bg-background block w-full rounded-md border px-3 py-2 text-sm"
                aria-invalid={form.formState.errors.title ? 'true' : 'false'}
                {...form.register('title')}
              />
              {form.formState.errors.title && (
                <p role="alert" className="text-destructive text-xs">
                  {form.formState.errors.title.message}
                </p>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="policy-body" className="text-sm font-medium">
              Isi kebijakan
            </label>
            <textarea
              id="policy-body"
              rows={10}
              placeholder="Salin-tempel teks kebijakan privasi anda…"
              className="border-input bg-background block w-full rounded-md border px-3 py-2 text-sm"
              aria-invalid={form.formState.errors.body ? 'true' : 'false'}
              {...form.register('body')}
            />
            <p className="text-muted-foreground text-xs">
              Maksimum 20.000 karakter. Format Markdown sederhana; tag HTML akan diperlakukan
              sebagai teks biasa.
            </p>
            {form.formState.errors.body && (
              <p role="alert" className="text-destructive text-xs">
                {form.formState.errors.body.message}
              </p>
            )}
          </div>
          {inlineError && (
            <div
              role="alert"
              className="border-destructive/50 bg-destructive/5 text-destructive rounded-md border p-3 text-sm"
            >
              {inlineError}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                form.reset({ version: '', title: '', body: '' });
              }}
              className="border-border inline-flex items-center rounded-md border px-4 py-2 text-sm"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={publishMutation.isPending}
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center rounded-md px-4 py-2 text-sm font-medium shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {publishMutation.isPending ? 'Menerbitkan…' : 'Terbitkan'}
            </button>
          </div>
        </form>
      )}

      {list.isLoading ? (
        <div
          role="status"
          aria-live="polite"
          className="border-border text-muted-foreground rounded-md border border-dashed p-6 text-sm"
        >
          Memuat daftar versi…
        </div>
      ) : list.data && list.data.length > 0 ? (
        <ul className="space-y-3">
          {list.data.map((p) => (
            <li key={p.id} className="border-border bg-card rounded-lg border p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="font-medium">
                    {p.title}
                    <span className="bg-muted text-muted-foreground ml-2 rounded px-2 py-0.5 text-xs">
                      v{p.version}
                    </span>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Berlaku sejak {new Date(p.effectiveAt).toLocaleString('id-ID', DATE_FORMAT)}
                  </p>
                </div>
              </div>
              <details className="mt-3">
                <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
                  Lihat isi kebijakan
                </summary>
                <pre className="bg-muted mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded p-3 text-xs">
                  {p.body}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <div className="border-border text-muted-foreground rounded-md border border-dashed p-6 text-sm">
          Belum ada versi kebijakan yang diterbitkan.
        </div>
      )}
    </div>
  );
}
