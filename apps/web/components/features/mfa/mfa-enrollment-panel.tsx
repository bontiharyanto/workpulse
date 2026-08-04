'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  mfaEnrollConfirmInputSchema,
  type MfaEnrollConfirmInput,
  type MfaEnrollStartResponse,
} from '@workpulse/shared-types';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { useAuth } from '@/components/providers/auth-provider';
import { ApiError, mfaApi } from '@/lib/api-client';
import { authStore, computeExpiryEpoch } from '@/lib/auth-store';

interface Props {
  /** Called after `enrollConfirm` succeeds. Receives the fresh backup codes. */
  onConfirmed?: (backupCodes: string[]) => void;
  /** Copy tuning for `/setup-mfa` (forced) vs `/settings/security` (voluntary). */
  variant: 'forced' | 'voluntary';
}

const ERROR_COPY: Record<string, string> = {
  MFA_INVALID_CODE: 'Kode tidak sesuai. Pastikan aplikasi authenticator Anda telah sinkron.',
  MFA_ALREADY_ENABLED: 'MFA sudah aktif. Nonaktifkan terlebih dahulu untuk enroll ulang.',
  MFA_ENROLLMENT_NOT_STARTED: 'Mulai enrollment dulu sebelum konfirmasi.',
  THROTTLED: 'Terlalu banyak percobaan. Coba lagi sebentar.',
};

/**
 * Two-phase MFA enrollment wizard:
 *
 *   Step 1 — Mulai: `POST /auth/mfa/enroll/start` returns QR + secret.
 *   Step 2 — Konfirmasi: user scans, types the current 6-digit code,
 *            server activates MFA + hands back a batch of backup codes.
 *
 * On success we call `refreshMe()` so the auth-store user object
 * reflects `mfaEnabled=true` and the surrounding gate stops firing.
 */
export function MfaEnrollmentPanel({ onConfirmed, variant }: Props): JSX.Element {
  const { refreshMe } = useAuth();
  const qc = useQueryClient();
  const [enrollment, setEnrollment] = useState<MfaEnrollStartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startMutation = useMutation({
    mutationFn: () => mfaApi.enrollStart(),
    onSuccess: (res) => {
      setError(null);
      setEnrollment(res);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setError(ERROR_COPY[err.code] ?? err.message);
      } else {
        setError('Tidak dapat memulai enrollment MFA.');
      }
    },
  });

  const form = useForm<MfaEnrollConfirmInput>({
    resolver: zodResolver(mfaEnrollConfirmInputSchema),
    defaultValues: { code: '' },
  });

  const confirmMutation = useMutation({
    mutationFn: (input: MfaEnrollConfirmInput) => mfaApi.enrollConfirm(input),
    onSuccess: async (res) => {
      setError(null);
      // Swap the access token so the MfaEnrollmentGuard on the
      // backend now sees `mfaEnabled=true`. `refreshMe()` re-fetches
      // /auth/me with the new token so the FE store is consistent.
      authStore.set({
        accessToken: res.accessToken,
        expiresAt: computeExpiryEpoch(res.accessTokenExpiresIn),
      });
      await refreshMe();
      await qc.invalidateQueries({ queryKey: ['mfa-status'] });
      setEnrollment(null);
      form.reset();
      onConfirmed?.(res.backupCodes);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setError(ERROR_COPY[err.code] ?? err.message);
      } else {
        setError('Tidak dapat menyelesaikan enrollment MFA.');
      }
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    confirmMutation.mutate({ code: values.code.trim() });
  });

  return (
    <div className="space-y-4">
      {variant === 'forced' && (
        <div
          role="status"
          className="rounded-md border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          Peran Anda mewajibkan aktivasi MFA sebelum menggunakan aplikasi. Selesaikan langkah di
          bawah untuk melanjutkan.
        </div>
      )}

      {!enrollment && (
        <button
          type="button"
          onClick={() => startMutation.mutate()}
          disabled={startMutation.isPending}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium shadow hover:opacity-90 disabled:opacity-50"
        >
          {startMutation.isPending ? 'Menghasilkan QR...' : 'Mulai aktifkan MFA'}
        </button>
      )}

      {enrollment && (
        <div className="border-input bg-background space-y-4 rounded-md border p-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Langkah 1 — Scan QR</p>
            <div className="flex justify-center">
              {}
              <img
                src={enrollment.qrCodeDataUri}
                alt="QR code untuk enrollment MFA"
                width={240}
                height={240}
                className="border-input rounded-md border"
              />
            </div>
            <details className="text-muted-foreground text-xs">
              <summary className="cursor-pointer underline underline-offset-4">
                Tidak bisa scan? Ketik secret manual.
              </summary>
              <p className="border-input bg-muted/50 mt-2 select-all break-all rounded-md border p-2 font-mono">
                {enrollment.secret}
              </p>
            </details>
          </div>

          <form onSubmit={onSubmit} className="space-y-3" noValidate>
            <div className="space-y-1">
              <label htmlFor="mfa-confirm-code" className="text-sm font-medium">
                Langkah 2 — Masukkan kode 6 digit dari authenticator
              </label>
              <input
                id="mfa-confirm-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
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

            <button
              type="submit"
              disabled={confirmMutation.isPending}
              className="bg-primary text-primary-foreground w-full rounded-md px-4 py-2 text-sm font-medium shadow hover:opacity-90 disabled:opacity-50"
            >
              {confirmMutation.isPending ? 'Mengaktifkan...' : 'Aktifkan MFA'}
            </button>
          </form>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Simple presentational component for backup codes. Shows a warning,
 * a monospaced grid, and copy/print helpers. Consumers persist the
 * "user acknowledged" state themselves so this is a pure UI unit.
 */
export function MfaBackupCodesReveal({
  codes,
  onAcknowledged,
}: {
  codes: string[];
  onAcknowledged: () => void;
}): JSX.Element {
  return (
    <div className="space-y-3 rounded-md border border-emerald-300/60 bg-emerald-50 p-4 text-sm text-emerald-900">
      <p className="font-medium">Simpan backup codes berikut</p>
      <p className="text-xs">
        Daftar ini <strong>hanya tampil sekali</strong>. Gunakan salah satu code ini untuk masuk
        jika kehilangan akses ke aplikasi authenticator. Setiap code hanya bisa digunakan satu kali.
      </p>
      <ul className="bg-background text-foreground grid grid-cols-2 gap-2 rounded-md border border-emerald-300/70 p-3 font-mono text-xs">
        {codes.map((c) => (
          <li key={c} className="tracking-wider">
            {c}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(codes.join('\n'));
          }}
          className="rounded-md border border-emerald-500 bg-white px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
        >
          Salin ke clipboard
        </button>
        <button
          type="button"
          onClick={onAcknowledged}
          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
        >
          Saya sudah menyimpannya
        </button>
      </div>
    </div>
  );
}

export function useMfaStatus(): ReturnType<
  typeof useQuery<Awaited<ReturnType<typeof mfaApi.status>>>
> {
  return useQuery({
    queryKey: ['mfa-status'],
    queryFn: () => mfaApi.status(),
    staleTime: 30_000,
  });
}
