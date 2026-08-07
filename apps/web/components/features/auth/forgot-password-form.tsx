'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordInputSchema, type ForgotPasswordInput } from '@workpulse/shared-types';
import { AlertTriangle, ArrowLeft, CheckCircle2, Mail } from 'lucide-react';
import Link from 'next/link';
import { useState, type JSX } from 'react';
import { useForm } from 'react-hook-form';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
        <Alert variant="success">
          <CheckCircle2 aria-hidden />
          <AlertTitle>Cek inbox Anda</AlertTitle>
          <AlertDescription>{GENERIC_SUCCESS_MESSAGE}</AlertDescription>
        </Alert>
        <p className="text-muted-foreground text-caption">
          Link reset berlaku 30 menit. Jika email tidak muncul di inbox, periksa folder spam atau
          minta bantuan HR untuk memverifikasi alamat email Anda.
        </p>
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link href="/login">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Kembali ke halaman masuk
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email terdaftar</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          aria-invalid={Boolean(form.formState.errors.email) || undefined}
          {...form.register('email')}
        />
        {form.formState.errors.email ? (
          <p role="alert" className="text-destructive text-caption">
            {form.formState.errors.email.message}
          </p>
        ) : null}
      </div>

      {submitError ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>Tidak dapat mengirim link</AlertTitle>
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" className="w-full" size="lg" disabled={form.formState.isSubmitting}>
        <Mail className="h-4 w-4" aria-hidden />
        {form.formState.isSubmitting ? 'Mengirim…' : 'Kirim link reset'}
      </Button>
    </form>
  );
}
