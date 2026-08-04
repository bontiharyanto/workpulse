import Link from 'next/link';

import { ClockPanel } from '@/components/features/attendance/clock-panel';
import { CompanyDashboardLink } from '@/components/features/attendance/company-dashboard-link';
import { MonthlySummaryWidget } from '@/components/features/attendance/monthly-summary-widget';
import { TeamAttendanceLink } from '@/components/features/attendance/team-attendance-link';

export default function AttendancePage(): JSX.Element {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kehadiran</h1>
          <p className="text-muted-foreground text-sm">
            Tekan tombol untuk memulai atau mengakhiri jam kerja. Lokasi Anda dikirim ke server
            untuk validasi geofence.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CompanyDashboardLink />
          <TeamAttendanceLink />
          <Link
            href="/attendance/corrections"
            className="border-input hover:bg-muted whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-medium"
          >
            Koreksi →
          </Link>
          <Link
            href="/attendance/history"
            className="border-input hover:bg-muted whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-medium"
          >
            Lihat riwayat →
          </Link>
        </div>
      </div>
      <ClockPanel />
      <MonthlySummaryWidget />
    </div>
  );
}
