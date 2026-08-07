import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { type JSX } from 'react';

import { CorrectionApprovals } from '@/components/features/attendance/correction-approvals';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';

export default function CorrectionApprovalsPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Persetujuan Koreksi Absensi"
        description="Daftar koreksi absensi yang menunggu keputusan Anda. Supervisor melihat tim mereka; HR dan Super Admin melihat seluruh tenant."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/attendance/corrections">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Riwayat saya
            </Link>
          </Button>
        }
      />
      <CorrectionApprovals />
    </div>
  );
}
