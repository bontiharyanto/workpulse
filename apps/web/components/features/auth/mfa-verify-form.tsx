'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { mfaVerifyInputSchema, type MfaVerifyInput } from '@workpulse/shared-types';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import { useAuth } from '@/components/providers/auth-provider';
import { ApiError, mfaApi } from '@/lib/api-client';

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

  // Only reachable in the pre-MFA state. If someone lands here with a
  // fully-verified session, ship them to the dashboard.
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
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => {
            setMode('totp');
            form.clearErrors();
            form.setValue('backupCode', '');
          }}
          className={
            mode === 'totp'
              ? 'border-primary bg-primary/10 text-primary rounded-md border px-3 py-1 font-medium'
              : 'border-input text-muted-foreground rounded-md border px-3 py-1'
          }
        >
          Kode aplikasi
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('backup');
            form.clearErrors();
            form.setValue('code', '');
          }}
          className={
            mode === 'backup'
              ? 'border-primary bg-primary/10 text-primary rounded-md border px-3 py-1 font-medium'
              : 'border-input text-muted-foreground rounded-md border px-3 py-1'
          }
        >
          Backup code
        </button>
      </div>

      {mode === 'totp' ? (
        <div className="space-y-1">
          <label htmlFor="code" className="text-sm font-medium">
            Kode 6 digit dari authenticator app
          </label>
          <input
            id="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            aria-invalid={Boolean(form.formState.errors.code) || undefined}
            className="border-input bg-background focus:ring-ring w-full rounded-md border px-3 py-2 text-center font-mono text-lg tracking-widest shadow-sm focus:outline-none focus:ring-2"
            {...form.register('code')}
          />
          {form.formState.errors.code && (
            <p role="alert" className="text-destructive text-xs">
              {form.formState.errors.code.message}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <label htmlFor="backupCode" className="text-sm font-medium">
            Backup code
          </label>
          <input
            id="backupCode"
            type="text"
            inputMode="text"
            autoFocus
            autoComplete="off"
            aria-invalid={Boolean(form.formState.errors.backupCode) || undefined}
            className="border-input bg-background focus:ring-ring w-full rounded-md border px-3 py-2 text-center font-mono shadow-sm focus:outline-none focus:ring-2"
            {...form.register('backupCode')}
          />
          {form.formState.errors.backupCode && (
            <p role="alert" className="text-destructive text-xs">
              {form.formState.errors.backupCode.message}
            </p>
          )}
          <p className="text-muted-foreground text-xs">
            Setiap backup code hanya bisa digunakan satu kali.
          </p>
        </div>
      )}

      {submitError && (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={form.formState.isSubmitting}
        className="bg-primary text-primary-foreground w-full rounded-md px-4 py-2 text-sm font-medium shadow hover:opacity-90 disabled:opacity-50"
      >
        {form.formState.isSubmitting ? 'Memverifikasi...' : 'Verifikasi'}
      </button>
    </form>
  );
}
