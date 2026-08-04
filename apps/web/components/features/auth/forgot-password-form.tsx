'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordInputSchema, type ForgotPasswordInput } from '@workpulse/shared-types';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { ApiError, authApi } from '@/lib/api-client';

/**
 * Success screen is intentionally generic — we NEVER tell the user
 * whether the email was on file. That policy lives on the server too
 * (see PasswordResetService.requestReset) but the client mirrors it
 * so a MITM observer can't distinguish response variants either.
 */
const GENERIC_SUCCESS_MESSAGE =
  'Jika email tersebut terdaftar, kami telah mengirimkan link reset password. Silakan cek inbox Anda dalam beberapa menit.';

const ERROR_COPY: Record<string, string> = {
  THROTTLED:
    'Anda mengirim permintaan terlalu sering. Silakan tunggu beberapa saat lalu coba lagi.',
};

export function ForgotPasswordForm(): JSX.Element {
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordInputSchema),
    defaultValues: { email: '' },
    mode: 'onTouched',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await authApi.forgotPassword(values);
      setSubmitted(true);
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

  if (submitted) {
    return (
      <div className="space-y-4">
        <div
          role="status"
          className="rounded-md border border-emerald-300/60 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          {GENERIC_SUCCESS_MESSAGE}
        </div>
        <p className="text-muted-foreground text-xs">
          Link reset berlaku 30 menit. Jika email tidak muncul di inbox, periksa folder spam atau
          minta bantuan HR untuk memverifikasi alamat email Anda.
        </p>
        <Link
          href="/login"
          className="text-primary inline-block text-sm font-medium underline underline-offset-4"
        >
          Kembali ke halaman masuk
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-1">
        <label htmlFor="email" className="text-sm font-medium">
          Email terdaftar
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          aria-invalid={Boolean(form.formState.errors.email) || undefined}
          className="border-input bg-background focus:ring-ring w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2"
          {...form.register('email')}
        />
        {form.formState.errors.email && (
          <p role="alert" className="text-destructive text-xs">
            {form.formState.errors.email.message}
          </p>
        )}
      </div>

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
        {form.formState.isSubmitting ? 'Mengirim...' : 'Kirim link reset'}
      </button>

      <p className="text-muted-foreground text-center text-xs">
        <Link href="/login" className="underline underline-offset-4">
          Kembali ke halaman masuk
        </Link>
      </p>
    </form>
  );
}
