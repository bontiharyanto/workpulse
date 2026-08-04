import Link from 'next/link';

import { CorrectionApprovals } from '@/components/features/attendance/correction-approvals';

export default function CorrectionApprovalsPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Persetujuan Koreksi Absensi
          </h1>
          <p className="text-sm text-muted-foreground">
            Daftar koreksi absensi yang menunggu keputusan Anda. Supervisor
            melihat tim mereka; HR / SUPER_ADMIN melihat seluruh tenant.
          </p>
        </div>
        <Link
          href="/attendance/corrections"
          className="whitespace-nowrap rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          ← Riwayat saya
        </Link>
      </div>
      <CorrectionApprovals />
    </div>
  );
}
