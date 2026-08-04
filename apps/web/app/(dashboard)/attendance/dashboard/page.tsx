import { type JSX } from 'react';

import { BacklogTile } from '@/components/features/approvals/backlog-tile';
import { CompanyDashboard } from '@/components/features/attendance/company-dashboard';
import { PageHeader } from '@/components/layout/page-header';

export default function CompanyAttendanceDashboardPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Dashboard Kehadiran HR"
        description="Rekap seluruh karyawan tenant untuk satu hari. Auto-refresh setiap 60 detik selama halaman terbuka. Hanya HR Manager dan Super Admin."
      />
      <div className="space-y-6">
        <BacklogTile />
        <CompanyDashboard />
      </div>
    </div>
  );
}
