import type { Metadata } from 'next';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { PrivacyPoliciesPanel } from '@/components/features/privacy/privacy-policies-panel';
import { PageHeader } from '@/components/layout/page-header';

export const metadata: Metadata = {
  title: 'Kebijakan privasi — Workpulse',
  robots: { index: false, follow: false },
};

export default function AdminPoliciesPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <div className="mx-auto max-w-3xl">
          <PageHeader
            title="Kebijakan privasi"
            description="Kelola versi kebijakan privasi yang akan ditampilkan kepada seluruh pengguna. Publikasi versi baru akan meminta setiap pengguna menerima ulang."
          />
          <PrivacyPoliciesPanel />
        </div>
      </RequireRole>
    </RequireAuth>
  );
}
