'use client';

import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type JSX } from 'react';

import { AuthShell } from '@/components/features/auth/auth-shell';
import { useAuth } from '@/components/providers/auth-provider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
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
      router.replace('/attendance' as Route);
    }
  }, [status, pending, router]);

  if (status === 'loading') {
    return (
      <AuthShell title="Memuat sesi…" size="sm">
        <div className="text-muted-foreground text-body flex items-center justify-center gap-2 py-6">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>Mempersiapkan halaman persetujuan…</span>
        </div>
      </AuthShell>
    );
  }

  if (status === 'unauthenticated') {
    router.replace('/login' as Route);
    return <span />;
  }

  if (!pending) {
    return (
      <AuthShell title="Mengarahkan…" size="sm">
        <div className="text-muted-foreground text-body flex items-center justify-center gap-2 py-6">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>Membuka halaman utama…</span>
        </div>
      </AuthShell>
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
    <AuthShell
      title={pending.title}
      description={
        <>
          Versi v{pending.version} · Berlaku{' '}
          {new Date(pending.effectiveAt).toLocaleDateString('id-ID', {
            year: 'numeric',
            month: 'long',
            day: '2-digit',
          })}
        </>
      }
      size="lg"
    >
      <p className="text-muted-foreground text-overline uppercase tracking-widest">
        Kebijakan privasi diperbarui
      </p>

      <ScrollArea className="border-border bg-muted/30 h-72 rounded-md border">
        <pre className="text-body whitespace-pre-wrap p-4 font-sans">{pending.body}</pre>
      </ScrollArea>

      <Label className="text-body flex items-start gap-2 font-normal">
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
          className="border-input text-primary focus:ring-primary mt-0.5 h-4 w-4 rounded"
        />
        <span>
          Saya telah membaca dan menyetujui kebijakan privasi versi{' '}
          <span className="font-medium">v{pending.version}</span>.
        </span>
      </Label>

      {errCopy ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>Tidak dapat menyimpan persetujuan</AlertTitle>
          <AlertDescription>{errCopy}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={!ack || mutation.isPending}
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          {mutation.isPending ? 'Menyimpan…' : 'Terima & lanjutkan'}
        </Button>
      </div>
    </AuthShell>
  );
}
