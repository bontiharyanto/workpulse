import { TeamAttendance } from '@/components/features/attendance/team-attendance';

export default function TeamAttendancePage(): JSX.Element {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Kehadiran Tim</h1>
        <p className="text-sm text-muted-foreground">
          Pantau siapa yang sudah clock-in, siapa yang terlambat, dan rekap disiplin per anggota.
          Supervisor melihat tim langsungnya; HR melihat seluruh tenant.
        </p>
      </div>
      <TeamAttendance />
    </div>
  );
}
