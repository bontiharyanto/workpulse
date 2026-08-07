import { CheckSquare } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { JSX } from 'react';

import { LeaveBalanceCard } from '@/components/features/leave/leave-balance-card';
import { LeaveSubmitForm } from '@/components/features/leave/leave-submit-form';
import { MyLeaveList } from '@/components/features/leave/my-leave-list';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';

export default function LeavePage(): JSX.Element {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Manajemen Cuti"
        description="Saldo, riwayat pengajuan, dan pengajuan cuti baru."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={'/leave/approvals' as Route}>
              <CheckSquare className="h-4 w-4" aria-hidden />
              Antrian approval
            </Link>
          </Button>
        }
      />

      <div className="space-y-6">
        <section className="space-y-3">
          <h2 className="text-muted-foreground text-overline uppercase tracking-widest">
            Saldo Tahun Ini
          </h2>
          <LeaveBalanceCard />
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <MyLeaveList />
          <LeaveSubmitForm />
        </section>
      </div>
    </div>
  );
}
