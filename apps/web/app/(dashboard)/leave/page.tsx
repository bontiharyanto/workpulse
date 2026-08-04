import Link from 'next/link';

import { LeaveBalanceCard } from '@/components/features/leave/leave-balance-card';
import { LeaveSubmitForm } from '@/components/features/leave/leave-submit-form';
import { MyLeaveList } from '@/components/features/leave/my-leave-list';

export default function LeavePage(): JSX.Element {
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Manajemen Cuti</h1>
          <p className="text-muted-foreground text-sm">
            Saldo, riwayat pengajuan, dan pengajuan cuti baru.
          </p>
        </div>
        <Link
          href="/leave/approvals"
          className="text-primary text-sm underline-offset-2 hover:underline"
        >
          Lihat halaman approval →
        </Link>
      </header>

      <section className="space-y-3">
        <h2 className="text-muted-foreground text-sm font-medium uppercase tracking-widest">
          Saldo Tahun Ini
        </h2>
        <LeaveBalanceCard />
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-muted-foreground text-sm font-medium uppercase tracking-widest">
            Pengajuan Saya
          </h2>
          <MyLeaveList />
        </div>
        <div>
          <LeaveSubmitForm />
        </div>
      </section>
    </div>
  );
}
