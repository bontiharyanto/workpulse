import type { Metadata } from 'next';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { TenantUsagePanel } from '@/components/features/admin/tenant-usage-panel';

export const metadata: Metadata = {
  title: 'Penggunaan tenant — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * OPS-7 — Cost / usage instrumentation.
 *
 *   - `HR_MANAGER` sees only their own tenant (per-tenant summary card).
 *   - `SUPER_ADMIN` sees a cross-tenant table + can regenerate any month.
 *
 * Metrics: storage bytes (DB-tracked exports + DSAR archives), DB row
 * counts, notification volume, webhook deliveries, active + total users.
 */
export default function AdminTenantUsagePage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Penggunaan tenant
            </h1>
            <p className="text-sm text-muted-foreground">
              Snapshot bulanan footprint tenant: storage, baris DB, volume
              notifikasi & webhook, dan user aktif. Menjadi dasar untuk
              perencanaan kapasitas serta tier billing di masa depan.
            </p>
          </div>
          <TenantUsagePanel />
        </main>
      </RequireRole>
    </RequireAuth>
  );
}
