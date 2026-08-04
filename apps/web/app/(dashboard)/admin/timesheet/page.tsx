import type { Metadata } from 'next';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { AdminTimesheetPanel } from '@/components/features/timesheet/admin-timesheet-panel';

export const metadata: Metadata = {
  title: 'Timesheet — Admin — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/admin/timesheet` — Fase 32a. HR / Super Admin queue view + generate
 * action. Supervisors are also welcome (the service scopes their list
 * to direct reports), so we broaden the RequireRole below.
 */
export default function AdminTimesheetPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN']}>
        <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Timesheet
            </h1>
            <p className="text-sm text-muted-foreground">
              Kelola dan tinjau timesheet karyawan per periode. Supervisor
              hanya melihat tim langsungnya; HR / Super Admin melihat
              seluruh tenant.
            </p>
          </div>
          <AdminTimesheetPanel />
        </main>
      </RequireRole>
    </RequireAuth>
  );
}
