'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  resetPasswordInputSchema,
  type ResetPasswordInput,
} from '@workpulse/shared-types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ApiError, authApi } from '@/lib/api-client';

/**
 * The form only asks for `password` + `passwordConfirm`; the token
 * comes from the query string and is stitched in at submit time so it
 * never ends up in a hidden input the user could edit.
 */
const formSchema = resetPasswordInputSchema
  .omit({ token: true })
  .extend({
    passwordConfirm: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'Konfirmasi password tidak cocok',
  });
type FormValues = z.infer<typeof formSchema>;

const ERROR_COPY: Record<string, string> = {
  INVALID_TOKEN:
    'Link reset ini tidak valid atau sudah kedaluwarsa. Silakan minta link baru dari halaman lupa password.',
  THROTTLED:
    'Terlalu banyak percobaan. Silakan tunggu beberapa saat lalu coba lagi.',
};

export function ResetPasswordForm({ token }: { token: string | null }): JSX.Element {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: '', passwordConfirm: '' },
    mode: 'onTouched',
  });

  if (!token) {
    return (
      <div className="space-y-4">
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          Link reset tidak lengkap. Silakan minta link baru.
        </div>
        <Link
          href="/forgot-password"
          className="inline-block text-sm font-medium text-primary underline underline-offset-4"
        >
          Minta link reset baru
        </Link>
      </div>
    );
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const payload: ResetPasswordInput = {
        token,
        password: values.password,
      };
      await authApi.resetPassword(payload);
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
          Password Anda berhasil diubah. Silakan masuk kembali menggunakan
          password baru.
        </div>
        <button
          type="button"
          onClick={() => router.replace('/login')}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:opacity-90"
        >
          Masuk sekarang
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-1">
        <label htmlFor="password" className="text-sm font-medium">
          Password baru
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          autoFocus
          minLength={8}
          aria-invalid={Boolean(form.formState.errors.password) || undefined}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          {...form.register('password')}
        />
        {form.formState.errors.password && (
          <p role="alert" className="text-xs text-destructive">
            {form.formState.errors.password.message}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Minimal 8 karakter. Gunakan kombinasi huruf besar, kecil, angka, dan simbol.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="passwordConfirm" className="text-sm font-medium">
          Konfirmasi password baru
        </label>
        <input
          id="passwordConfirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
          aria-invalid={Boolean(form.formState.errors.passwordConfirm) || undefined}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          {...form.register('passwordConfirm')}
        />
        {form.formState.errors.passwordConfirm && (
          <p role="alert" className="text-xs text-destructive">
            {form.formState.errors.passwordConfirm.message}
          </p>
        )}
      </div>

      {submitError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={form.formState.isSubmitting}
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:opacity-90 disabled:opacity-50"
      >
        {form.formState.isSubmitting ? 'Menyimpan...' : 'Simpan password baru'}
      </button>

      <p className="text-center text-xs text-muted-foreground">
        <Link href="/login" className="underline underline-offset-4">
          Kembali ke halaman masuk
        </Link>
      </p>
    </form>
  );
}
