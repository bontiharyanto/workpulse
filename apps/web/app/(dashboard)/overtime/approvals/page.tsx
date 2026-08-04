import { ArrowLeft } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { JSX } from 'react';

import { OvertimeApprovalList } from '@/components/features/overtime/overtime-approval-list';
import { OvertimeCompletionRunner } from '@/components/features/overtime/overtime-completion-runner';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';

export default function OvertimeApprovalsPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Approval Lembur"
        description="Supervisor melihat pengajuan dari tim langsung; HR Manager & Super Admin melihat seluruh pengajuan tenant."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={'/overtime' as Route}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Kembali ke Lembur
            </Link>
          </Button>
        }
      />

      <OvertimeCompletionRunner />
      <OvertimeApprovalList />
    </div>
  );
}
