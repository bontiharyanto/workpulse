import { FileClock } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { RetentionPolicyPanel } from '@/components/features/privacy/retention-policy-panel';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Kebijakan retensi data — Workpulse',
  robots: { index: false, follow: false },
};

export default function AdminRetentionPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <div className="mx-auto max-w-3xl">
          <PageHeader
            title="Kebijakan retensi data"
            description="Atur berapa lama data operasional disimpan sebelum dihapus otomatis oleh job retensi harian."
            actions={
              <Button asChild variant="outline" size="sm">
                <Link href={'/admin/privacy/retention/audit-reports' as Route}>
                  <FileClock className="h-4 w-4" aria-hidden />
                  Audit bulanan
                </Link>
              </Button>
            }
          />
          <RetentionPolicyPanel />
        </div>
      </RequireRole>
    </RequireAuth>
  );
}
