import type { Metadata } from 'next';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { DpiaRegistryPanel } from '@/components/features/dpia/dpia-registry-panel';

export const metadata: Metadata = {
  title: 'DPIA — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/admin/dpia` — Fase 31e landing page for Data Protection Impact
 * Assessments. Only `HR_MANAGER` and `SUPER_ADMIN` may view.
 */
export default function AdminDpiaPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Data Protection Impact Assessment
            </h1>
            <p className="text-sm text-muted-foreground">
              Penilaian dampak perlindungan data pribadi (GDPR Art. 35 · UU
              27/2022 PDP Pasal 34). Setiap DPIA terkait dengan sebuah
              aktivitas ROPA dan berisi register risiko dengan skor inherent
              maupun residual pasca-mitigasi.
            </p>
          </div>
          <DpiaRegistryPanel />
        </main>
      </RequireRole>
    </RequireAuth>
  );
}
