import { ArrowLeft } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { TimesheetExportsPanel } from '@/components/features/timesheet/timesheet-exports-panel';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Export Timesheet — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/admin/timesheet/exports` — HR / Super Admin surface for
 * generating payroll CSV / XLSX exports and reviewing the audit
 * trail (SHA-256, signed share URLs).
 */
export default function AdminTimesheetExportsPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <div className="mx-auto max-w-6xl">
          <PageHeader
            title="Export Timesheet ke Payroll"
            description="Unduh CSV / XLSX yang berisi rollup atau detail harian dari timesheet berstatus APPROVED. Setiap ekspor tercatat pada audit trail dengan SHA-256 payload."
            actions={
              <Button asChild variant="outline" size="sm">
                <Link href={'/admin/timesheet' as Route}>
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Kembali ke antrian
                </Link>
              </Button>
            }
          />
          <TimesheetExportsPanel />
        </div>
      </RequireRole>
    </RequireAuth>
  );
}
