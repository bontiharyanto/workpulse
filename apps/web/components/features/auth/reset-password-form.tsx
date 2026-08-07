'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { resetPasswordInputSchema, type ResetPasswordInput } from '@workpulse/shared-types';
import { AlertTriangle, CheckCircle2, Lock, LogIn } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  THROTTLED: 'Terlalu banyak percobaan. Silakan tunggu beberapa saat lalu coba lagi.',
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
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>Link reset tidak lengkap</AlertTitle>
          <AlertDescription>Silakan minta link baru dari halaman lupa password.</AlertDescription>
        </Alert>
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link href="/forgot-password">Minta link reset baru</Link>
        </Button>
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
        <Alert variant="success">
          <CheckCircle2 aria-hidden />
          <AlertTitle>Password berhasil diubah</AlertTitle>
          <AlertDescription>Silakan masuk kembali menggunakan password baru.</AlertDescription>
        </Alert>
        <Button type="button" onClick={() => router.replace('/login')} className="w-full" size="lg">
          <LogIn className="h-4 w-4" aria-hidden />
          Masuk sekarang
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password baru</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          autoFocus
          minLength={8}
          aria-invalid={Boolean(form.formState.errors.password) || undefined}
          {...form.register('password')}
        />
        {form.formState.errors.password ? (
          <p role="alert" className="text-destructive text-caption">
            {form.formState.errors.password.message}
          </p>
        ) : null}
        <p className="text-muted-foreground text-caption">
          Minimal 8 karakter. Gunakan kombinasi huruf besar, kecil, angka, dan simbol.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="passwordConfirm">Konfirmasi password baru</Label>
        <Input
          id="passwordConfirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
          aria-invalid={Boolean(form.formState.errors.passwordConfirm) || undefined}
          {...form.register('passwordConfirm')}
        />
        {form.formState.errors.passwordConfirm ? (
          <p role="alert" className="text-destructive text-caption">
            {form.formState.errors.passwordConfirm.message}
          </p>
        ) : null}
      </div>

      {submitError ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>Tidak dapat menyimpan password</AlertTitle>
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" className="w-full" size="lg" disabled={form.formState.isSubmitting}>
        <Lock className="h-4 w-4" aria-hidden />
        {form.formState.isSubmitting ? 'Menyimpan…' : 'Simpan password baru'}
      </Button>
    </form>
  );
}
