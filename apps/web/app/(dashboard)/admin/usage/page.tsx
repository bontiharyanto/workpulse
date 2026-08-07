import type { Metadata } from 'next';
import type { JSX } from 'react';

import { TenantUsagePanel } from '@/components/features/admin/tenant-usage-panel';
import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { PageHeader } from '@/components/layout/page-header';

export const metadata: Metadata = {
  title: 'Penggunaan tenant — Workpulse',
  robots: { index: false, follow: false },
};

export default function AdminTenantUsagePage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <div className="mx-auto max-w-6xl">
          <PageHeader
            title="Penggunaan tenant"
            description="Snapshot bulanan footprint tenant: storage, baris DB, volume notifikasi & webhook, dan user aktif. Menjadi dasar untuk perencanaan kapasitas serta tier billing di masa depan."
          />
          <TenantUsagePanel />
        </div>
      </RequireRole>
    </RequireAuth>
  );
}
