import type { Metadata } from 'next';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { RetentionAuditReportDetail } from '@/components/features/privacy/retention-audit-report-detail';

export const metadata: Metadata = {
  title: 'Retention Audit — Detail — Workpulse',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminRetentionAuditReportDetailPage({
  params,
}: PageProps): Promise<JSX.Element> {
  const { id } = await params;
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <div className="mx-auto max-w-4xl">
          <RetentionAuditReportDetail reportId={id} />
        </div>
      </RequireRole>
    </RequireAuth>
  );
}
