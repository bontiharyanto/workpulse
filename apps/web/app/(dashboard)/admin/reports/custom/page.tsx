import { ArrowLeft } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { CustomReportBuilder } from '@/components/features/reports/custom/custom-report-builder';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Custom Report — Workpulse',
  robots: { index: false, follow: false },
};

export default function AdminCustomReportPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <div className="mx-auto max-w-6xl">
          <PageHeader
            title="Custom Report Builder"
            description={
              <>
                Susun laporan ad-hoc dari kombinasi <strong>dimension</strong> (day / department /
                user), <strong>metric</strong>, dan <strong>window</strong>. Simpan sebagai favorit,
                export CSV / XLSX, atau jadwalkan lewat menu Jadwal Laporan.
              </>
            }
            actions={
              <Button asChild variant="outline" size="sm">
                <Link href={'/admin/reports' as Route}>
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Laporan
                </Link>
              </Button>
            }
          />
          <CustomReportBuilder />
        </div>
      </RequireRole>
    </RequireAuth>
  );
}
