import type { Metadata } from 'next';
import type { JSX } from 'react';

import { AuthShell } from '@/components/features/auth/auth-shell';
import { ChangePasswordForm } from '@/components/features/auth/change-password-form';
import { RequireAuth } from '@/components/features/auth/require-auth';

export const metadata: Metadata = {
  title: 'Ubah password — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * Two entry points funnel here:
 *   1. Voluntary — a signed-in user chose to rotate their password.
 *   2. Forced   — the JWT reports `mustChangePassword: true` (fresh admin-
 *      issued temp password). In that case the FE store already redirected
 *      the caller here, and the API's `MustChangePasswordGuard` will refuse
 *      every other authenticated endpoint until the change succeeds.
 */
export default function ChangePasswordPage(): JSX.Element {
  return (
    <RequireAuth>
      <AuthShell
        title="Ubah password"
        description="Setelah berhasil, seluruh sesi di setiap perangkat akan di-logout dan Anda harus login ulang dengan password baru."
      >
        <ChangePasswordForm />
      </AuthShell>
    </RequireAuth>
  );
}
