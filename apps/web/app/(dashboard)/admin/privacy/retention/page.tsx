import type { Metadata } from 'next';
import Link from 'next/link';
import type { Route } from 'next';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { RetentionPolicyPanel } from '@/components/features/privacy/retention-policy-panel';

export const metadata: Metadata = {
  title: 'Kebijakan retensi data — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/admin/privacy/retention` — Fase 31c. HR / Super Admin surface for
 * configuring the tenant's data-retention policy. Enforced client-side
 * by `RequireRole`; server-side by `RolesGuard` on the controller.
 */
export default function AdminRetentionPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">Kebijakan retensi data</h1>
              <p className="text-muted-foreground text-sm">
                Atur berapa lama data operasional disimpan sebelum dihapus otomatis oleh job retensi
                harian.
              </p>
            </div>
            <Link
              href={'/admin/privacy/retention/audit-reports' as unknown as Route}
              className="border-border bg-card text-foreground hover:border-primary/60 rounded-md border px-3 py-1.5 text-sm"
            >
              Lihat Audit bulanan →
            </Link>
          </div>
          <RetentionPolicyPanel />
        </main>
      </RequireRole>
    </RequireAuth>
  );
}
