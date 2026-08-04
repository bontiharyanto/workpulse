import type { Metadata } from 'next';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { TimesheetConfigPanel } from '@/components/features/timesheet/timesheet-config-panel';

export const metadata: Metadata = {
  title: 'Konfigurasi Timesheet — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/admin/timesheet/config` — Fase 32a. HR / Super Admin surface for
 * setting the tenant's timesheet period type and timezone.
 */
export default function AdminTimesheetConfigPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Konfigurasi Timesheet</h1>
            <p className="text-muted-foreground text-sm">
              Atur jenis periode (mingguan, dua-mingguan, bulanan, atau cutoff harian) yang dipakai
              oleh timesheet generator.
            </p>
          </div>
          <TimesheetConfigPanel />
        </main>
      </RequireRole>
    </RequireAuth>
  );
}
