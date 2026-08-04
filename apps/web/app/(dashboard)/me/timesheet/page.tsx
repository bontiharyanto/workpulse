import type { Metadata } from 'next';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { MyTimesheetPanel } from '@/components/features/timesheet/my-timesheet-panel';
import { PageHeader } from '@/components/layout/page-header';

export const metadata: Metadata = {
  title: 'Timesheet saya — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/me/timesheet` — self-service surface for the currently
 * authenticated user. Server materializes the current period +
 * totals + entries; the FE only reads.
 */
export default function MyTimesheetPage(): JSX.Element {
  return (
    <RequireAuth>
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title="Timesheet saya"
          description="Ringkasan jam kerja, lembur, cuti, dan absen yang tercatat selama periode berjalan."
        />
        <MyTimesheetPanel />
      </div>
    </RequireAuth>
  );
}
