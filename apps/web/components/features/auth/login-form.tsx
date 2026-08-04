'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { loginInputSchema, type LoginInput } from '@workpulse/shared-types';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import { useAuth } from '@/components/providers/auth-provider';
import { ApiError } from '@/lib/api-client';

const ERROR_COPY: Record<string, string> = {
  UNAUTHORIZED: 'Email atau kata sandi salah.',
  THROTTLED: 'Terlalu banyak percobaan. Silakan coba lagi nanti.',
};

/**
 * Route to send the user after a successful login. Priorities:
 *   1. `mustChangePassword=true`     → `/change-password`
 *   2. `mfaRequired=true`            → `/login/mfa`
 *   3. `mfaEnrollmentRequired=true`  → `/setup-mfa`
 *   4. `redirectTo` (default `/attendance`)
 *
 * Every step here mirrors an API guard, so a stale/tampered client
 * cache can't skip any gate — the backend re-checks on the first
 * request that lands. The enrollment gate reads
 * `user.mfaEnrollmentRequired` (baked by the API from role + config)
 * instead of computing role membership on the client, so the
 * `MFA_ENFORCE_HR_ADMIN=false` override (test/emergency only) also
 * disables the FE redirect.
 */
const CHANGE_PASSWORD_PATH = '/change-password';
const MFA_VERIFY_PATH = '/login/mfa';
const MFA_SETUP_PATH = '/setup-mfa';

export function LoginForm({ redirectTo }: { redirectTo: string }): JSX.Element {
  const { login, status, user } = useAuth();
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginInputSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onTouched',
  });

  useEffect(() => {
    if (status !== 'authenticated' || !user) return;
    if (user.mustChangePassword === true) {
      router.replace(CHANGE_PASSWORD_PATH as Route);
      return;
    }
    if (user.mfaEnabled === true && user.mfaPassed === false) {
      router.replace(MFA_VERIFY_PATH as Route);
      return;
    }
    if (user.mfaEnrollmentRequired === true) {
      router.replace(MFA_SETUP_PATH as Route);
      return;
    }
    router.replace(redirectTo as Route);
  }, [status, user, redirectTo, router]);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const result = await login(values);
      // `login()` populated authStore synchronously; the effect above
      // will fire on the next re-render. Kick a router.replace here
      // too so the caller doesn't briefly see the previous redirect
      // target flash before the effect resolves.
      if (result.mfaRequired) {
        router.replace(MFA_VERIFY_PATH as Route);
      } else {
        router.replace(redirectTo as Route);
      }
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
      <div className="space-y-1">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          aria-invalid={Boolean(form.formState.errors.email) || undefined}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          {...form.register('email')}
        />
        {form.formState.errors.email && (
          <p role="alert" className="text-xs text-destructive">
            {form.formState.errors.email.message}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor="password" className="text-sm font-medium">
            Kata sandi
          </label>
          <Link
            href="/forgot-password"
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Lupa password?
          </Link>
        </div>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={Boolean(form.formState.errors.password) || undefined}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          {...form.register('password')}
        />
        {form.formState.errors.password && (
          <p role="alert" className="text-xs text-destructive">
            {form.formState.errors.password.message}
          </p>
        )}
      </div>

      {submitError && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={form.formState.isSubmitting}
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:opacity-90 disabled:opacity-50"
      >
        {form.formState.isSubmitting ? 'Masuk...' : 'Masuk'}
      </button>
    </form>
  );
}
