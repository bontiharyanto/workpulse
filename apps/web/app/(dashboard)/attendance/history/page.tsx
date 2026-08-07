import { type JSX } from 'react';

import { AttendanceHistory } from '@/components/features/attendance/attendance-history';
import { PageHeader } from '@/components/layout/page-header';

export default function AttendanceHistoryPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Riwayat Kehadiran"
        description="Rekaman clock-in dan clock-out Anda beserta indikator keterlambatan dan pulang cepat."
      />
      <AttendanceHistory />
    </div>
  );
}
