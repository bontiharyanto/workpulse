import Link from 'next/link';

import { OvertimeMineList } from '@/components/features/overtime/overtime-mine-list';
import { OvertimeSubmitForm } from '@/components/features/overtime/overtime-submit-form';

export default function OvertimePage(): JSX.Element {
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Manajemen Lembur</h1>
          <p className="text-muted-foreground text-sm">
            Ajukan pekerjaan lembur, pantau status persetujuan, dan lihat estimasi pembayaran
            berdasarkan kebijakan perusahaan.
          </p>
        </div>
        <Link
          href="/overtime/approvals"
          className="text-primary text-sm underline-offset-2 hover:underline"
        >
          Approval Lembur →
        </Link>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-muted-foreground text-sm font-medium uppercase tracking-widest">
            Pengajuan Saya
          </h2>
          <OvertimeMineList />
        </div>
        <div>
          <OvertimeSubmitForm />
        </div>
      </section>
    </div>
  );
}
