import { ArrowLeft } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { JSX } from 'react';

import { ApprovalList } from '@/components/features/leave/approval-list';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';

export default function LeaveApprovalsPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Approval Cuti"
        description="Supervisor melihat pengajuan dari tim langsung; HR Manager melihat pengajuan yang sudah lolos level 1."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={'/leave' as Route}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Kembali ke Cuti
            </Link>
          </Button>
        }
      />
      <ApprovalList />
    </div>
  );
}
