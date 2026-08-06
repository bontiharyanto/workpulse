'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { mfaVerifyInputSchema, type MfaVerifyInput } from '@workpulse/shared-types';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type JSX } from 'react';
import { useForm } from 'react-hook-form';

import { useAuth } from '@/components/providers/auth-provider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, mfaApi } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const ERROR_COPY: Record<string, string> = {
  MFA_INVALID_CODE: 'Kode MFA tidak valid.',
  MFA_MISSING_REFRESH: 'Sesi login tidak lengkap. Silakan login ulang.',
  MFA_NOT_ENABLED: 'MFA tidak aktif untuk akun ini. Silakan login ulang.',
  THROTTLED: 'Terlalu banyak percobaan. Coba lagi dalam beberapa detik.',
};

/**
 * Second-factor step of the login flow. Reachable only when the caller
 * already holds a pre-MFA access token (mfaPassed=false) + a valid
 * refresh cookie. Accepts either a 6-digit TOTP code OR a one-time
 * backup code — the shared Zod schema enforces exactly-one-of.
 */
export function MfaVerifyForm({ redirectTo }: { redirectTo: string }): JSX.Element {
  const { user, status, completeMfa } = useAuth();
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [mode, setMode] = useState<'totp' | 'backup'>('totp');

  const form = useForm<MfaVerifyInput>({
    resolver: zodResolver(mfaVerifyInputSchema),
    defaultValues: { code: '', backupCode: '' },
    mode: 'onSubmit',
  });

  useEffect(() => {
    if (status !== 'authenticated' || !user) return;
    if (user.mfaEnabled !== true || user.mfaPassed !== false) {
      router.replace(redirectTo as Route);
    }
  }, [status, user, redirectTo, router]);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    const payload: MfaVerifyInput =
      mode === 'totp' ? { code: values.code?.trim() } : { backupCode: values.backupCode?.trim() };
    try {
      const res = await mfaApi.verify(payload);
      await completeMfa({
        accessToken: res.accessToken,
        accessTokenExpiresIn: res.accessTokenExpiresIn,
      });
      router.replace(redirectTo as Route);
    } catch (err) {
      // Defense-in-depth: if the backend still returns CONSENT_REQUIRED
      // here (e.g. an old deployment or a middleware ordering regression),
      // send the user to `/consent` instead of showing a misleading
      // "Verifikasi gagal" toast — the TOTP code they typed may well have
      // been valid; consent is just an orthogonal follow-up gate.
      if (err instanceof ApiError && err.code === 'CONSENT_REQUIRED') {
        router.replace('/consent' as Route);
        return;
      }
      if (err instanceof ApiError) {
        setSubmitError(ERROR_COPY[err.code] ?? err.message ?? 'Terjadi kesalahan.');
      } else if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError('Terjadi kesalahan yang tidak terduga.');
      }
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div
        role="group"
        aria-label="Metode verifikasi"
        className="border-border grid grid-cols-2 rounded-md border p-1"
      >
        <button
          type="button"
          aria-pressed={mode === 'totp'}
          onClick={() => {
            setMode('totp');
            form.clearErrors();
            form.setValue('backupCode', '');
          }}
          className={cn(
            'text-caption rounded px-3 py-1.5 font-medium transition-colors',
            mode === 'totp'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Kode aplikasi
        </button>
        <button
          type="button"
          aria-pressed={mode === 'backup'}
          onClick={() => {
            setMode('backup');
            form.clearErrors();
            form.setValue('code', '');
          }}
          className={cn(
            'text-caption rounded px-3 py-1.5 font-medium transition-colors',
            mode === 'backup'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Backup code
        </button>
      </div>

      {mode === 'totp' ? (
        <div className="space-y-1.5">
          <Label htmlFor="code">Kode 6 digit dari authenticator app</Label>
          <Input
            id="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            aria-invalid={Boolean(form.formState.errors.code) || undefined}
            className="text-center font-mono text-lg tracking-widest"
            {...form.register('code')}
          />
          {form.formState.errors.code ? (
            <p role="alert" className="text-destructive text-caption">
              {form.formState.errors.code.message}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="backupCode">Backup code</Label>
          <Input
            id="backupCode"
            type="text"
            inputMode="text"
            autoFocus
            autoComplete="off"
            aria-invalid={Boolean(form.formState.errors.backupCode) || undefined}
            className="text-center font-mono"
            {...form.register('backupCode')}
          />
          {form.formState.errors.backupCode ? (
            <p role="alert" className="text-destructive text-caption">
              {form.formState.errors.backupCode.message}
            </p>
          ) : null}
          <p className="text-muted-foreground text-caption">
            Setiap backup code hanya bisa digunakan satu kali.
          </p>
        </div>
      )}

      {submitError ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>Verifikasi gagal</AlertTitle>
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      ) : null}

      <Button
        type="submit"
        className="w-full"
        size="lg"
        disabled={form.formState.isSubmitting}
      >
        <ShieldCheck className="h-4 w-4" aria-hidden />
        {form.formState.isSubmitting ? 'Memverifikasi…' : 'Verifikasi'}
      </Button>
    </form>
  );
}
