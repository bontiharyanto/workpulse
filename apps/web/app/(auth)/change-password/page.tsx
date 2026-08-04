import type { Metadata } from 'next';

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
 *
 * Wrapped in `<RequireAuth>` because both flows demand a valid session —
 * anonymous callers coming through a stale bookmark are bounced to /login.
 */
export default function ChangePasswordPage(): JSX.Element {
  return (
    <RequireAuth>
      <main className="bg-muted/30 flex min-h-screen items-center justify-center px-4">
        <div className="bg-background w-full max-w-sm rounded-lg border p-6 shadow-sm">
          <div className="mb-6 space-y-1">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-widest">
              Workpulse
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">Ubah password</h1>
            <p className="text-muted-foreground text-sm">
              Setelah berhasil, seluruh sesi di setiap perangkat akan di-logout dan Anda harus login
              ulang dengan password baru.
            </p>
          </div>
          <ChangePasswordForm />
        </div>
      </main>
    </RequireAuth>
  );
}
