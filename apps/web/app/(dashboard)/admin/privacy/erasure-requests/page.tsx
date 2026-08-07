import type { Metadata } from 'next';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { ErasureAdminPanel } from '@/components/features/privacy/erasure-admin-panel';
import { PageHeader } from '@/components/layout/page-header';

export const metadata: Metadata = {
  title: 'Permintaan penghapusan data — Workpulse',
  robots: { index: false, follow: false },
};

export default function AdminErasureRequestsPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <div className="mx-auto max-w-3xl">
          <PageHeader
            title="Permintaan penghapusan data"
            description="Kelola pengajuan hak untuk dilupakan (right-to-erasure). Semua tindakan tercatat pada audit log."
          />
          <ErasureAdminPanel />
        </div>
      </RequireRole>
    </RequireAuth>
  );
}
