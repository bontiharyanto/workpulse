import type { Metadata } from 'next';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { PrivacyPoliciesPanel } from '@/components/features/privacy/privacy-policies-panel';

export const metadata: Metadata = {
  title: 'Kebijakan privasi — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/admin/privacy/policies` — Fase 31c. Publish + list tenant privacy
 * policy versions. Every publish resets user consents; users see the
 * new version on their next login.
 */
export default function AdminPoliciesPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Kebijakan privasi
            </h1>
            <p className="text-sm text-muted-foreground">
              Kelola versi kebijakan privasi yang akan ditampilkan kepada
              seluruh pengguna. Publikasi versi baru akan meminta setiap
              pengguna menerima ulang.
            </p>
          </div>
          <PrivacyPoliciesPanel />
        </main>
      </RequireRole>
    </RequireAuth>
  );
}
