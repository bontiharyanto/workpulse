import type { Metadata } from 'next';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { AdminTimesheetPanel } from '@/components/features/timesheet/admin-timesheet-panel';
import { PageHeader } from '@/components/layout/page-header';

export const metadata: Metadata = {
  title: 'Timesheet — Admin — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/admin/timesheet` — HR / Super Admin queue view + generate action.
 * Supervisors are also welcome (the service scopes their list to
 * direct reports), so we broaden `RequireRole` accordingly. Server
 * `@Roles` guard remains the source of truth (rules/20 §3).
 */
export default function AdminTimesheetPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN']}>
        <div className="mx-auto max-w-6xl">
          <PageHeader
            title="Timesheet"
            description="Kelola dan tinjau timesheet karyawan per periode. Supervisor hanya melihat tim langsungnya; HR / Super Admin melihat seluruh tenant."
          />
          <AdminTimesheetPanel />
        </div>
      </RequireRole>
    </RequireAuth>
  );
}
