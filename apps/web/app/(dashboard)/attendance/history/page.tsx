import { AttendanceHistory } from '@/components/features/attendance/attendance-history';

export default function AttendanceHistoryPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Riwayat Kehadiran</h1>
        <p className="text-sm text-muted-foreground">
          Rekaman clock-in / clock-out Anda beserta indikator keterlambatan dan pulang cepat.
        </p>
      </div>
      <AttendanceHistory />
    </div>
  );
}
