import { CheckSquare } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { JSX } from 'react';

import { OvertimeMineList } from '@/components/features/overtime/overtime-mine-list';
import { OvertimeSubmitForm } from '@/components/features/overtime/overtime-submit-form';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';

export default function OvertimePage(): JSX.Element {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Manajemen Lembur"
        description="Ajukan pekerjaan lembur, pantau status persetujuan, dan lihat estimasi pembayaran berdasarkan kebijakan perusahaan."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={'/overtime/approvals' as Route}>
              <CheckSquare className="h-4 w-4" aria-hidden />
              Antrian approval
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <OvertimeMineList />
        <OvertimeSubmitForm />
      </div>
    </div>
  );
}
