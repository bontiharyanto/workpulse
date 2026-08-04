'use client';

import { useMutation } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useAuth } from '@/components/providers/auth-provider';
import { ApiError, consentApi } from '@/lib/api-client';

/**
 * `/consent` — Fase 31c. Users with `pendingConsent != null` are
 * force-routed here by `RequireAuth`. Successful acceptance clears
 * the field on the next `/auth/me` refresh, so we refresh the auth
 * state before navigating back to the app root.
 */
export default function ConsentPage(): JSX.Element {
  const { user, status, refreshMe } = useAuth();
  const router = useRouter();
  const [ack, setAck] = useState(false);

  const pending = user?.pendingConsent ?? null;

  const mutation = useMutation({
    mutationFn: () => {
      if (!pending) throw new Error('no pending consent');
      return consentApi.accept(pending.id);
    },
    onSuccess: async () => {
      await refreshMe();
      router.replace('/attendance' as Route);
    },
  });

  useEffect(() => {
    if (status === 'authenticated' && !pending) {
      // The gate is stale — bounce to the app.
      router.replace('/attendance' as Route);
    }
  }, [status, pending, router]);

  if (status === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <p className="text-sm text-muted-foreground">Memuat sesi…</p>
      </main>
    );
  }

  if (status === 'unauthenticated') {
    router.replace('/login' as Route);
    return <span />;
  }

  if (!pending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <p className="text-sm text-muted-foreground">Mengarahkan…</p>
      </main>
    );
  }

  const errCopy =
    mutation.error instanceof ApiError
      ? mutation.error.code === 'CONSENT_ALREADY_ACCEPTED'
        ? 'Anda sudah pernah menerima kebijakan ini. Silakan muat ulang halaman.'
        : mutation.error.message
      : mutation.error
        ? 'Terjadi kesalahan saat menyimpan persetujuan.'
        : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-2xl space-y-4 rounded-lg border bg-background p-6 shadow-sm">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Kebijakan privasi diperbarui
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {pending.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            Versi v{pending.version} · Berlaku{' '}
            {new Date(pending.effectiveAt).toLocaleDateString('id-ID', {
              year: 'numeric',
              month: 'long',
              day: '2-digit',
            })}
          </p>
        </div>

        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-4 text-sm">
          {pending.body}
        </pre>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            className="mt-1"
          />
          <span>
            Saya telah membaca dan menyetujui kebijakan privasi versi v
            {pending.version}.
          </span>
        </label>

        {errCopy && (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {errCopy}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={!ack || mutation.isPending}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mutation.isPending ? 'Menyimpan…' : 'Terima & lanjutkan'}
          </button>
        </div>
      </div>
    </main>
  );
}
