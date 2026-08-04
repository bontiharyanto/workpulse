import type { Metadata } from 'next';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { RetentionAuditReportDetail } from '@/components/features/privacy/retention-audit-report-detail';

export const metadata: Metadata = {
  title: 'Retention Audit — Detail — Workpulse',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { id: string };
}

/**
 * OPS-6 — Detail view for one retention audit report. Shows every
 * finding with severity, counters vs policy snapshot side-by-side,
 * and the raw workerLastRunAt so an operator can correlate with
 * cron logs.
 */
export default function AdminRetentionAuditReportDetailPage({
  params,
}: PageProps): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
          <RetentionAuditReportDetail reportId={params.id} />
        </main>
      </RequireRole>
    </RequireAuth>
  );
}
