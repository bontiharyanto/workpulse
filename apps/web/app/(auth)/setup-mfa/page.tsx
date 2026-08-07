'use client';

import { Loader2 } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type JSX } from 'react';

import { AuthShell } from '@/components/features/auth/auth-shell';
import {
  MfaBackupCodesReveal,
  MfaEnrollmentPanel,
} from '@/components/features/mfa/mfa-enrollment-panel';
import { useAuth } from '@/components/providers/auth-provider';

export default function SetupMfaPage(): JSX.Element {
  const { user, status } = useAuth();
  const router = useRouter();
  const [codes, setCodes] = useState<string[] | null>(null);

  useEffect(() => {
    if (status !== 'authenticated' || !user) return;
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
      <AuthShell title="Memuat sesi…" size="sm">
        <div className="text-muted-foreground text-body flex items-center justify-center gap-2 py-6">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>Menyiapkan pengaturan MFA…</span>
        </div>
      </AuthShell>
    );
  }

  if (status === 'unauthenticated') {
    router.replace('/login' as Route);
    return <span />;
  }

  return (
    <AuthShell
      title="Aktifkan MFA"
      description="Gunakan aplikasi seperti Google Authenticator, Authy, atau 1Password. Aktifkan MFA untuk mengamankan akun Anda."
      size="md"
    >
      {codes ? (
        <MfaBackupCodesReveal codes={codes} onAcknowledged={handleAcknowledged} />
      ) : (
        <MfaEnrollmentPanel variant="forced" onConfirmed={setCodes} />
      )}
    </AuthShell>
  );
}
