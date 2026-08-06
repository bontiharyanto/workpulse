import type { Metadata } from 'next';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { MfaManagementPanel } from '@/components/features/mfa/mfa-management-panel';
import { SessionsPanel } from '@/components/features/security/sessions-panel';

export const metadata: Metadata = {
  title: 'Keamanan — Workpulse',
  robots: { index: false, follow: false },
};

export default function SecuritySettingsPage(): JSX.Element {
  return (
    <RequireAuth>
      <div className="space-y-6">
        <header className="space-y-1">
          <h2 className="text-h4 text-foreground tracking-tight">Keamanan akun</h2>
          <p className="text-muted-foreground text-body">
            Kelola verifikasi 2 langkah (MFA), backup codes, dan sesi login aktif. MFA bersifat{' '}
            <span className="text-foreground font-medium">opsional</span> untuk semua peran —
            termasuk HR dan Super Admin — sampai Super Admin menyalakan kewajiban di{' '}
            <code className="text-xs">/admin/security</code>.
          </p>
        </header>
        <MfaManagementPanel />
        <SessionsPanel />
      </div>
    </RequireAuth>
  );
}
