import { ArrowLeft } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { JSX } from 'react';

import { BacklogDetail } from '@/components/features/approvals/backlog-detail';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';

export default function ApprovalsBacklogPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Backlog Persetujuan"
        description="Ringkasan lintas modul untuk permintaan yang masih menunggu keputusan — Cuti, Lembur, dan Koreksi Absensi. Geser ambang “stale” untuk fokus pada backlog yang mendesak."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={'/attendance/dashboard' as Route}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Dashboard HR
            </Link>
          </Button>
        }
      />
      <BacklogDetail />
    </div>
  );
}
