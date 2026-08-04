import { History, PencilLine } from 'lucide-react';
import Link from 'next/link';
import { type JSX } from 'react';

import { ClockPanel } from '@/components/features/attendance/clock-panel';
import { CompanyDashboardLink } from '@/components/features/attendance/company-dashboard-link';
import { MonthlySummaryWidget } from '@/components/features/attendance/monthly-summary-widget';
import { TeamAttendanceLink } from '@/components/features/attendance/team-attendance-link';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';

export default function AttendancePage(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Kehadiran"
        description="Tekan tombol untuk memulai atau mengakhiri jam kerja. Lokasi Anda dikirim ke server untuk validasi geofence."
        actions={
          <>
            <CompanyDashboardLink />
            <TeamAttendanceLink />
            <Button asChild variant="outline" size="sm">
              <Link href="/attendance/corrections">
                <PencilLine className="h-4 w-4" aria-hidden />
                Koreksi
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/attendance/history">
                <History className="h-4 w-4" aria-hidden />
                Riwayat
              </Link>
            </Button>
          </>
        }
      />
      <div className="space-y-6">
        <ClockPanel />
        <MonthlySummaryWidget />
      </div>
    </div>
  );
}
