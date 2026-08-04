'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  changePasswordInputSchema,
  type ChangePasswordInput,
} from '@workpulse/shared-types';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useAuth } from '@/components/providers/auth-provider';
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
      // cookie. We use a full-page navigation (not `router.replace`)
      // because the surrounding `RequireAuth` wrapper subscribes to the
      // auth store: the moment we call `authStore.clear()`, a competing
      // `router.replace('/login')` fires from RequireAuth's useEffect
      // and strips our `?changed=1` query. `window.location.assign`
      // wins that race cleanly and also drops any client state that
      // still expected to be authenticated. `?changed=1` triggers the
      // "berhasil diubah" toast on the login page.
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
      {isForced && (
        <div
          role="status"
          className="rounded-md border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          Password Anda saat ini adalah password sementara. Silakan pilih
          password baru untuk melanjutkan.
        </div>
      )}

      <div className="space-y-1">
        <label htmlFor="currentPassword" className="text-sm font-medium">
          Password saat ini
        </label>
        <input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          autoFocus
          aria-invalid={Boolean(form.formState.errors.currentPassword) || undefined}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          {...form.register('currentPassword')}
        />
        {form.formState.errors.currentPassword && (
          <p role="alert" className="text-xs text-destructive">
            {form.formState.errors.currentPassword.message}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="newPassword" className="text-sm font-medium">
          Password baru
        </label>
        <input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          aria-invalid={Boolean(form.formState.errors.newPassword) || undefined}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          {...form.register('newPassword')}
        />
        {form.formState.errors.newPassword && (
          <p role="alert" className="text-xs text-destructive">
            {form.formState.errors.newPassword.message}
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

      {!isForced && (
        <p className="text-center text-xs text-muted-foreground">
          <Link href="/settings/notifications" className="underline underline-offset-4">
            Batal
          </Link>
        </p>
      )}
    </form>
  );
}
