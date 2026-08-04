import Link from 'next/link';

import { CorrectionForm } from '@/components/features/attendance/correction-form';
import { CorrectionList } from '@/components/features/attendance/correction-list';

export default function CorrectionsPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Koreksi Absensi</h1>
          <p className="text-sm text-muted-foreground">
            Ajukan koreksi jika Anda lupa clock-in atau clock-out. Permintaan Anda
            akan diteruskan ke supervisor / HR untuk disetujui.
          </p>
        </div>
        <Link
          href="/attendance/corrections/approvals"
          className="whitespace-nowrap rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          Antrian persetujuan →
        </Link>
      </div>
      <CorrectionForm />
      <CorrectionList />
    </div>
  );
}
