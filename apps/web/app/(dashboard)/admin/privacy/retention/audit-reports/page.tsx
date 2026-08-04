import { ArrowLeft } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { RetentionAuditReportsPanel } from '@/components/features/privacy/retention-audit-reports-panel';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Retention Enforcement Audit — Workpulse',
  robots: { index: false, follow: false },
};

export default function AdminRetentionAuditReportsPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <div className="mx-auto max-w-5xl">
          <PageHeader
            title="Retention Enforcement Audit"
            description={
              <>
                Laporan bulanan yang memverifikasi bahwa <em>RetentionWorker</em> benar-benar
                menjalankan pruning sesuai kebijakan retensi. Setiap temuan (gap) berarti ada data
                yang seharusnya sudah dihapus tapi masih tersimpan.
              </>
            }
            actions={
              <Button asChild variant="outline" size="sm">
                <Link href={'/admin/privacy/retention' as Route}>
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Kebijakan retensi
                </Link>
              </Button>
            }
          />
          <RetentionAuditReportsPanel />
        </div>
      </RequireRole>
    </RequireAuth>
  );
}
