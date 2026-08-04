import type { Metadata } from 'next';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { MyTimesheetPanel } from '@/components/features/timesheet/my-timesheet-panel';

export const metadata: Metadata = {
  title: 'Timesheet saya — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/me/timesheet` — Fase 32a. Self-service surface for the currently
 * authenticated user. Read-only in this phase; submit/approve arrives
 * in Fase 32b.
 */
export default function MyTimesheetPage(): JSX.Element {
  return (
    <RequireAuth>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Timesheet saya
          </h1>
          <p className="text-sm text-muted-foreground">
            Ringkasan jam kerja, lembur, cuti, dan absen yang tercatat
            selama periode berjalan.
          </p>
        </div>
        <MyTimesheetPanel />
      </main>
    </RequireAuth>
  );
}
