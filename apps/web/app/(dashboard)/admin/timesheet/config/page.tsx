import { ArrowLeft } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { TimesheetConfigPanel } from '@/components/features/timesheet/timesheet-config-panel';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Konfigurasi Timesheet — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/admin/timesheet/config` — HR / Super Admin surface for setting
 * the tenant's timesheet period type and automation windows.
 */
export default function AdminTimesheetConfigPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <div className="mx-auto max-w-3xl">
          <PageHeader
            title="Konfigurasi Timesheet"
            description="Atur jenis periode (mingguan, dua-mingguan, bulanan, atau cutoff harian) yang dipakai oleh timesheet generator."
            actions={
              <Button asChild variant="outline" size="sm">
                <Link href={'/admin/timesheet' as Route}>
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Kembali ke antrian
                </Link>
              </Button>
            }
          />
          <TimesheetConfigPanel />
        </div>
      </RequireRole>
    </RequireAuth>
  );
}
