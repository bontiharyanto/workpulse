import type { Metadata } from 'next';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { ErasureAdminPanel } from '@/components/features/privacy/erasure-admin-panel';

export const metadata: Metadata = {
  title: 'Permintaan penghapusan data — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/admin/privacy/erasure-requests` — HR / Super Admin queue for
 * right-to-erasure decisions (Fase 31b). Enforced client-side by
 * `RequireRole`; the backend uses `RolesGuard` on the same set.
 */
export default function AdminErasureRequestsPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Permintaan penghapusan data</h1>
            <p className="text-muted-foreground text-sm">
              Kelola pengajuan hak untuk dilupakan (right-to-erasure). Semua tindakan tercatat pada
              audit log.
            </p>
          </div>
          <ErasureAdminPanel />
        </main>
      </RequireRole>
    </RequireAuth>
  );
}
