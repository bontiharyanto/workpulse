'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordInputSchema, type ChangePasswordInput } from '@workpulse/shared-types';
import { AlertTriangle, Info, Lock } from 'lucide-react';
import Link from 'next/link';
import { useState, type JSX } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useAuth } from '@/components/providers/auth-provider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, authApi } from '@/lib/api-client';
import { authStore } from '@/lib/auth-store';

/**
 * Adds `passwordConfirm` on top of the shared-types schema. The confirm
 * field never touches the wire — it's stripped in `onSubmit`.
 */
const formSchema = changePasswordInputSchema
  .and(
    z.object({
      passwordConfirm: z.string(),
    }),
  )
  .refine((data) => data.newPassword === data.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'Konfirmasi password tidak cocok',
  });
type FormValues = z.infer<typeof formSchema>;

const ERROR_COPY: Record<string, string> = {
  INVALID_CREDENTIALS: 'Password lama Anda salah.',
  SAME_PASSWORD: 'Password baru tidak boleh sama dengan password lama.',
  THROTTLED: 'Terlalu banyak percobaan. Silakan tunggu sebentar dan coba lagi.',
};

export function ChangePasswordForm(): JSX.Element {
  const { user } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { currentPassword: '', newPassword: '', passwordConfirm: '' },
    mode: 'onTouched',
  });

  const isForced = user?.mustChangePassword === true;

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const payload: ChangePasswordInput = {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      };
      await authApi.changePassword(payload);
      // The API revoked every refresh token — including this device's
      // cookie. Full-page navigation because RequireAuth would otherwise
      // strip our `?changed=1` query in a competing router.replace.
      authStore.clear();
      window.location.assign('/login?changed=1');
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
      {isForced ? (
        <Alert variant="warning" role="status">
          <Info aria-hidden />
          <AlertTitle>Password sementara terdeteksi</AlertTitle>
          <AlertDescription>
            Password Anda saat ini adalah password sementara. Silakan pilih password baru untuk
            melanjutkan.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="currentPassword">Password saat ini</Label>
        <Input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          autoFocus
          aria-invalid={Boolean(form.formState.errors.currentPassword) || undefined}
          {...form.register('currentPassword')}
        />
        {form.formState.errors.currentPassword ? (
          <p role="alert" className="text-destructive text-caption">
            {form.formState.errors.currentPassword.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="newPassword">Password baru</Label>
        <Input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          aria-invalid={Boolean(form.formState.errors.newPassword) || undefined}
          {...form.register('newPassword')}
        />
        {form.formState.errors.newPassword ? (
          <p role="alert" className="text-destructive text-caption">
            {form.formState.errors.newPassword.message}
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

      <Button
        type="submit"
        className="w-full"
        size="lg"
        disabled={form.formState.isSubmitting}
      >
        <Lock className="h-4 w-4" aria-hidden />
        {form.formState.isSubmitting ? 'Menyimpan…' : 'Simpan password baru'}
      </Button>

      {!isForced ? (
        <p className="text-muted-foreground text-center text-caption">
          <Link href="/settings/notifications" className="underline underline-offset-4">
            Batal
          </Link>
        </p>
      ) : null}
    </form>
  );
}
