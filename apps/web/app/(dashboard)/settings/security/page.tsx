import type { Metadata } from 'next';

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
      <main className="mx-auto max-w-2xl space-y-8 px-4 py-8">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Keamanan akun</h1>
          <p className="text-sm text-muted-foreground">
            Kelola verifikasi 2 langkah (MFA), backup codes, dan sesi login
            aktif.
          </p>
        </div>
        <MfaManagementPanel />
        <SessionsPanel />
      </main>
    </RequireAuth>
  );
}
