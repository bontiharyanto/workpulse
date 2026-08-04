import type { Metadata } from 'next';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { RetentionAuditReportsPanel } from '@/components/features/privacy/retention-audit-reports-panel';

export const metadata: Metadata = {
  title: 'Retention Enforcement Audit — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * OPS-6 — HR / Super Admin surface. Monthly attestation that the
 * `RetentionWorker` honoured the tenant's `RetentionPolicy`. Read-only
 * by default; the manual regenerate button lets an operator re-run
 * a specific month after a policy fix or worker post-mortem.
 */
export default function AdminRetentionAuditReportsPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Retention Enforcement Audit
            </h1>
            <p className="text-sm text-muted-foreground">
              Laporan bulanan yang memverifikasi bahwa <em>RetentionWorker</em>{' '}
              benar-benar menjalankan pruning sesuai kebijakan retensi. Setiap
              temuan (gap) berarti ada data yang seharusnya sudah dihapus tapi
              masih tersimpan.
            </p>
          </div>
          <RetentionAuditReportsPanel />
        </main>
      </RequireRole>
    </RequireAuth>
  );
}
