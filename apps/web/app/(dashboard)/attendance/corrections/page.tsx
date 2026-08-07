import { ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { type JSX } from 'react';

import { CorrectionForm } from '@/components/features/attendance/correction-form';
import { CorrectionList } from '@/components/features/attendance/correction-list';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';

export default function CorrectionsPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Koreksi Absensi"
        description="Ajukan koreksi jika Anda lupa clock-in atau clock-out. Permintaan Anda akan diteruskan ke supervisor / HR untuk disetujui."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/attendance/corrections/approvals">
              <ClipboardCheck className="h-4 w-4" aria-hidden />
              Antrian persetujuan
            </Link>
          </Button>
        }
      />
      <div className="space-y-6">
        <CorrectionForm />
        <CorrectionList />
      </div>
    </div>
  );
}
