import type { Metadata } from 'next';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { ReportSchedulesPanel } from '@/components/features/reports/report-schedules-panel';

export const metadata: Metadata = {
  title: 'Jadwal Laporan — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/admin/reports/schedules` — Fase 33c UI for scheduled email reports.
 * HR / super-admin only.
 */
export default function AdminReportSchedulesPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Jadwal Laporan Email
            </h1>
            <p className="text-sm text-muted-foreground">
              Kirim laporan PDF secara otomatis (harian / mingguan / bulanan)
              ke daftar recipient. Cron server-side dispatch tiap 15 menit,
              setiap pengiriman tercatat di delivery log dengan SHA-256
              payload.
            </p>
          </div>
          <ReportSchedulesPanel />
        </main>
      </RequireRole>
    </RequireAuth>
  );
}
