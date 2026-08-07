import { type JSX } from 'react';

import { TeamAttendance } from '@/components/features/attendance/team-attendance';
import { PageHeader } from '@/components/layout/page-header';

export default function TeamAttendancePage(): JSX.Element {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Kehadiran Tim"
        description="Pantau siapa yang sudah clock-in, siapa yang terlambat, dan rekap disiplin per anggota. Supervisor melihat tim langsungnya; HR melihat seluruh tenant."
      />
      <TeamAttendance />
    </div>
  );
}
