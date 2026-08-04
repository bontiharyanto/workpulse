import type { Metadata } from 'next';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { BreachLedgerPanel } from '@/components/features/breach/breach-ledger-panel';

export const metadata: Metadata = {
  title: 'Breach Ledger — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/admin/security/breaches` — Fase 31g Breach Notification Ledger.
 * HR / super-admin only. Countdown badge + timeline + regulator PDF
 * export are all server-rendered from `deadline.hoursRemaining` and
 * `timeline[]`; FE has no math authority.
 */
export default function AdminBreachLedgerPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Breach Notification Ledger
            </h1>
            <p className="text-sm text-muted-foreground">
              Catat insiden pelanggaran perlindungan data. UU 27/2022 PDP
              Pasal 46 ayat (3) mewajibkan notifikasi ke Kominfo dan
              subjek data terdampak dalam <strong>72 jam</strong> sejak
              insiden diketahui. Sistem menampilkan countdown +
              reminder T-24h / T-4h / OVERDUE dan menyediakan PDF
              regulator-ready.
            </p>
          </div>
          <BreachLedgerPanel />
        </main>
      </RequireRole>
    </RequireAuth>
  );
}
