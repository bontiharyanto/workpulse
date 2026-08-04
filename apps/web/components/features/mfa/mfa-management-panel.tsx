'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  mfaBackupCodesInputSchema,
  mfaDisableInputSchema,
  type MfaBackupCodesInput,
  type MfaDisableInput,
} from '@workpulse/shared-types';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { useAuth } from '@/components/providers/auth-provider';
import { ApiError, mfaApi } from '@/lib/api-client';
import { authStore } from '@/lib/auth-store';

import {
  MfaBackupCodesReveal,
  MfaEnrollmentPanel,
  useMfaStatus,
} from '@/components/features/mfa/mfa-enrollment-panel';

const ERROR_COPY: Record<string, string> = {
  MFA_INVALID_CODE: 'Kode MFA tidak sesuai.',
  MFA_NOT_ENABLED: 'MFA belum aktif.',
  INVALID_CREDENTIALS: 'Password tidak sesuai.',
  THROTTLED: 'Terlalu banyak percobaan. Tunggu sebentar.',
};

/**
 * Complete MFA management surface for authenticated users:
 *  - Status card (enabled/disabled, backup codes remaining)
 *  - Enrollment wizard when disabled
 *  - Regenerate-backup-codes flow
 *  - Disable flow (requires password + current TOTP)
 *
 * Reused by `/settings/security` (voluntary) and can be embedded
 * inside admin surfaces in the future.
 */
export function MfaManagementPanel(): JSX.Element {
  const { refreshMe } = useAuth();
  const qc = useQueryClient();
  const status = useMfaStatus();
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [disableError, setDisableError] = useState<string | null>(null);
  const [regenError, setRegenError] = useState<string | null>(null);

  const disableForm = useForm<MfaDisableInput>({
    resolver: zodResolver(mfaDisableInputSchema),
    defaultValues: { currentPassword: '', code: '' },
  });
  const regenForm = useForm<MfaBackupCodesInput>({
    resolver: zodResolver(mfaBackupCodesInputSchema),
    defaultValues: { code: '' },
  });

  const disableMutation = useMutation({
    mutationFn: (body: MfaDisableInput) => mfaApi.disable(body),
    onSuccess: async () => {
      setDisableError(null);
      // The API revoked every refresh token — the current cookie is
      // now stale. Force a full logout so the FE state is consistent.
      authStore.clear();
      window.location.assign('/login');
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setDisableError(ERROR_COPY[err.code] ?? err.message);
      } else {
        setDisableError('Tidak dapat menonaktifkan MFA.');
      }
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: (body: MfaBackupCodesInput) => mfaApi.regenerateBackupCodes(body),
    onSuccess: async (res) => {
      setRegenError(null);
      setNewCodes(res.backupCodes);
      regenForm.reset();
      await qc.invalidateQueries({ queryKey: ['mfa-status'] });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setRegenError(ERROR_COPY[err.code] ?? err.message);
      } else {
        setRegenError('Tidak dapat meregenerasi backup codes.');
      }
    },
  });

  if (status.isLoading) {
    return <p className="text-muted-foreground text-sm">Memuat status MFA...</p>;
  }
  if (status.error || !status.data) {
    return <p className="text-destructive text-sm">Tidak dapat memuat status MFA.</p>;
  }

  const s = status.data;

  return (
    <div className="space-y-6">
      <section className="border-input bg-background space-y-3 rounded-md border p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Status MFA</p>
            <p className="text-muted-foreground text-xs">
              {s.enabled
                ? `Aktif sejak ${s.enabledAt ? new Date(s.enabledAt).toLocaleString('id-ID') : '-'} · ${s.remainingBackupCodes} backup codes tersisa.`
                : 'MFA belum diaktifkan pada akun Anda.'}
            </p>
          </div>
          <span
            className={
              s.enabled
                ? 'rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-900'
                : 'bg-muted text-muted-foreground rounded-full px-3 py-1 text-xs font-medium'
            }
          >
            {s.enabled ? 'Aktif' : 'Nonaktif'}
          </span>
        </div>
      </section>

      {!s.enabled ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Aktifkan MFA</h2>
          <p className="text-muted-foreground text-sm">
            Tambahkan lapisan keamanan kedua untuk akun Anda. Setelah aktif, login akan meminta kode
            dari aplikasi authenticator.
          </p>
          <MfaEnrollmentPanel
            variant="voluntary"
            onConfirmed={async (codes) => {
              setNewCodes(codes);
              await refreshMe();
            }}
          />
          {newCodes && (
            <MfaBackupCodesReveal codes={newCodes} onAcknowledged={() => setNewCodes(null)} />
          )}
        </section>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">Regenerasi backup codes</h2>
            <p className="text-muted-foreground text-sm">
              Buat batch backup codes baru. Semua code lama akan langsung tidak berlaku. Butuh
              konfirmasi TOTP.
            </p>
            <form
              onSubmit={regenForm.handleSubmit((v) =>
                regenerateMutation.mutate({ code: v.code.trim() }),
              )}
              className="flex gap-2"
              noValidate
            >
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="Kode 6 digit"
                aria-label="Kode TOTP untuk regenerasi backup codes"
                className="border-input bg-background focus:ring-ring w-32 rounded-md border px-3 py-2 text-center font-mono text-sm shadow-sm focus:outline-none focus:ring-2"
                {...regenForm.register('code')}
              />
              <button
                type="submit"
                disabled={regenerateMutation.isPending}
                className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium shadow hover:opacity-90 disabled:opacity-50"
              >
                {regenerateMutation.isPending ? 'Regenerasi...' : 'Regenerasi'}
              </button>
            </form>
            {regenForm.formState.errors.code && (
              <p role="alert" className="text-destructive text-xs">
                {regenForm.formState.errors.code.message}
              </p>
            )}
            {regenError && (
              <p role="alert" className="text-destructive text-xs">
                {regenError}
              </p>
            )}
            {newCodes && (
              <MfaBackupCodesReveal codes={newCodes} onAcknowledged={() => setNewCodes(null)} />
            )}
          </section>

          <section className="border-input space-y-3 border-t pt-4">
            <h2 className="text-lg font-semibold tracking-tight">Nonaktifkan MFA</h2>
            <p className="text-muted-foreground text-sm">
              Butuh password saat ini dan kode TOTP. Setelah dinonaktifkan, semua sesi login akan
              di-logout — Anda harus login ulang.
            </p>
            <form
              onSubmit={disableForm.handleSubmit((v) => disableMutation.mutate(v))}
              className="space-y-3"
              noValidate
            >
              <div className="space-y-1">
                <label htmlFor="disable-pw" className="text-sm font-medium">
                  Password saat ini
                </label>
                <input
                  id="disable-pw"
                  type="password"
                  autoComplete="current-password"
                  className="border-input bg-background focus:ring-ring w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2"
                  {...disableForm.register('currentPassword')}
                />
                {disableForm.formState.errors.currentPassword && (
                  <p role="alert" className="text-destructive text-xs">
                    {disableForm.formState.errors.currentPassword.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label htmlFor="disable-code" className="text-sm font-medium">
                  Kode TOTP
                </label>
                <input
                  id="disable-code"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  className="border-input bg-background focus:ring-ring w-32 rounded-md border px-3 py-2 text-center font-mono text-sm shadow-sm focus:outline-none focus:ring-2"
                  {...disableForm.register('code')}
                />
                {disableForm.formState.errors.code && (
                  <p role="alert" className="text-destructive text-xs">
                    {disableForm.formState.errors.code.message}
                  </p>
                )}
              </div>
              {disableError && (
                <p role="alert" className="text-destructive text-xs">
                  {disableError}
                </p>
              )}
              <button
                type="submit"
                disabled={disableMutation.isPending}
                className="border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {disableMutation.isPending ? 'Menonaktifkan...' : 'Nonaktifkan MFA'}
              </button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
