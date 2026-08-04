'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { loginInputSchema, type LoginInput } from '@workpulse/shared-types';
import { AlertTriangle, LogIn } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type JSX } from 'react';
import { useForm } from 'react-hook-form';

import { useAuth } from '@/components/providers/auth-provider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
 * instead of computing role membership on the client.
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
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
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

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="password">Kata sandi</Label>
          <Link
            href="/forgot-password"
            className="text-muted-foreground hover:text-foreground text-caption underline underline-offset-4"
          >
            Lupa password?
          </Link>
        </div>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={Boolean(form.formState.errors.password) || undefined}
          {...form.register('password')}
        />
        {form.formState.errors.password ? (
          <p role="alert" className="text-destructive text-caption">
            {form.formState.errors.password.message}
          </p>
        ) : null}
      </div>

      {submitError ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>Tidak dapat masuk</AlertTitle>
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      ) : null}

      <Button
        type="submit"
        className="w-full"
        size="lg"
        disabled={form.formState.isSubmitting}
      >
        <LogIn className="h-4 w-4" aria-hidden />
        {form.formState.isSubmitting ? 'Masuk…' : 'Masuk'}
      </Button>
    </form>
  );
}
