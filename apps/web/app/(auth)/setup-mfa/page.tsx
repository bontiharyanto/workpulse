'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useAuth } from '@/components/providers/auth-provider';
import {
  MfaBackupCodesReveal,
  MfaEnrollmentPanel,
} from '@/components/features/mfa/mfa-enrollment-panel';

export default function SetupMfaPage(): JSX.Element {
  const { user, status } = useAuth();
  const router = useRouter();
  const [codes, setCodes] = useState<string[] | null>(null);

  useEffect(() => {
    if (status !== 'authenticated' || !user) return;
    // If MFA is already enabled, redirect to settings. Guards this
    // page against re-entry after enrollment.
    if (user.mfaEnabled === true) {
      router.replace('/settings/security' as Route);
    }
  }, [status, user, router]);

  const handleAcknowledged = (): void => {
    setCodes(null);
    router.replace('/attendance' as Route);
  };

  if (status === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <p className="text-sm text-muted-foreground">Memuat sesi...</p>
      </main>
    );
  }

  if (status === 'unauthenticated') {
    router.replace('/login' as Route);
    return <span />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-lg space-y-4 rounded-lg border bg-background p-6 shadow-sm">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Workpulse
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Aktifkan MFA</h1>
          <p className="text-sm text-muted-foreground">
            Gunakan aplikasi seperti Google Authenticator, Authy, atau
            1Password. Aktifkan MFA untuk mengamankan akun Anda.
          </p>
        </div>

        {codes ? (
          <MfaBackupCodesReveal codes={codes} onAcknowledged={handleAcknowledged} />
        ) : (
          <MfaEnrollmentPanel variant="forced" onConfirmed={setCodes} />
        )}
      </div>
    </main>
  );
}
