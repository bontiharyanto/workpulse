import { ArrowLeft } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { ReportSchedulesPanel } from '@/components/features/reports/report-schedules-panel';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Jadwal Laporan — Workpulse',
  robots: { index: false, follow: false },
};

export default function AdminReportSchedulesPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <div className="mx-auto max-w-6xl">
          <PageHeader
            title="Jadwal Laporan Email"
            description="Kirim laporan PDF secara otomatis (harian / mingguan / bulanan) ke daftar recipient. Cron server-side dispatch tiap 15 menit, setiap pengiriman tercatat di delivery log dengan SHA-256 payload."
            actions={
              <Button asChild variant="outline" size="sm">
                <Link href={'/admin/reports' as Route}>
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Laporan
                </Link>
              </Button>
            }
          />
          <ReportSchedulesPanel />
        </div>
      </RequireRole>
    </RequireAuth>
  );
}
