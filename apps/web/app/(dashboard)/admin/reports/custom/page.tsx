import type { Metadata } from 'next';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { CustomReportBuilder } from '@/components/features/reports/custom/custom-report-builder';

export const metadata: Metadata = {
  title: 'Custom Report — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/admin/reports/custom` — Fase 33b DPO-facing custom report builder.
 * HR / super-admin only. Definition validated against the closed
 * dimension × metric catalogue on the server before execution.
 */
export default function AdminCustomReportPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Custom Report Builder
            </h1>
            <p className="text-sm text-muted-foreground">
              Susun laporan ad-hoc dari kombinasi <strong>dimension</strong>
              (day / department / user), <strong>metric</strong>, dan
              <strong>window</strong>. Simpan sebagai favorit, export CSV /
              XLSX, atau jadwalkan lewat menu Jadwal Laporan.
            </p>
          </div>
          <CustomReportBuilder />
        </main>
      </RequireRole>
    </RequireAuth>
  );
}
