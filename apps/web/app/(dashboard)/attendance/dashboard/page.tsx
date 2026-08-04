import { BacklogTile } from '@/components/features/approvals/backlog-tile';
import { CompanyDashboard } from '@/components/features/attendance/company-dashboard';

export default function CompanyAttendanceDashboardPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard Kehadiran HR</h1>
        <p className="text-muted-foreground text-sm">
          Rekap seluruh karyawan tenant untuk satu hari. Auto-refresh setiap 60 detik selama halaman
          terbuka. Hanya HR Manager &amp; Super Admin.
        </p>
      </div>
      <BacklogTile />
      <CompanyDashboard />
    </div>
  );
}
