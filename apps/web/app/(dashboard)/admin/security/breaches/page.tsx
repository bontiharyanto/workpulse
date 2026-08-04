import type { Metadata } from 'next';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { BreachLedgerPanel } from '@/components/features/breach/breach-ledger-panel';
import { PageHeader } from '@/components/layout/page-header';

export const metadata: Metadata = {
  title: 'Breach Ledger — Workpulse',
  robots: { index: false, follow: false },
};

export default function AdminBreachLedgerPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <div className="mx-auto max-w-6xl">
          <PageHeader
            title="Breach Notification Ledger"
            description={
              <>
                Catat insiden pelanggaran perlindungan data. UU 27/2022 PDP Pasal 46 ayat (3)
                mewajibkan notifikasi ke Kominfo dan subjek data terdampak dalam{' '}
                <strong>72 jam</strong> sejak insiden diketahui. Sistem menampilkan countdown +
                reminder T-24h / T-4h / OVERDUE dan menyediakan PDF regulator-ready.
              </>
            }
          />
          <BreachLedgerPanel />
        </div>
      </RequireRole>
    </RequireAuth>
  );
}
