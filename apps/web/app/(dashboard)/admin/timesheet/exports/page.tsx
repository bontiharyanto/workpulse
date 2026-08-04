import type { Metadata } from 'next';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { TimesheetExportsPanel } from '@/components/features/timesheet/timesheet-exports-panel';

export const metadata: Metadata = {
  title: 'Export Timesheet — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/admin/timesheet/exports` — Fase 32c. HR / Super Admin surface for
 * generating payroll CSV / XLSX exports and reviewing the audit trail.
 */
export default function AdminTimesheetExportsPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Export Timesheet ke Payroll
            </h1>
            <p className="text-sm text-muted-foreground">
              Unduh CSV / XLSX yang berisi rollup atau detail harian dari
              timesheet berstatus <span className="font-medium">APPROVED</span>.
              Setiap ekspor tercatat pada audit trail dengan SHA-256 payload.
            </p>
          </div>
          <TimesheetExportsPanel />
        </main>
      </RequireRole>
    </RequireAuth>
  );
}
