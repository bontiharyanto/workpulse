import Link from 'next/link';

import { BacklogDetail } from '@/components/features/approvals/backlog-detail';

export default function ApprovalsBacklogPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Backlog Persetujuan
          </h1>
          <p className="text-sm text-muted-foreground">
            Ringkasan lintas modul untuk permintaan yang masih menunggu
            keputusan — Cuti, Lembur, dan Koreksi Absensi. Geser ambang
            &quot;stale&quot; untuk fokus pada backlog yang mendesak.
          </p>
        </div>
        <Link
          href="/attendance/dashboard"
          className="whitespace-nowrap rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          ← Dashboard HR
        </Link>
      </div>
      <BacklogDetail />
    </div>
  );
}
