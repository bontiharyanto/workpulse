import type { Metadata } from 'next';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { DpiaRegistryPanel } from '@/components/features/dpia/dpia-registry-panel';
import { PageHeader } from '@/components/layout/page-header';

export const metadata: Metadata = {
  title: 'DPIA — Workpulse',
  robots: { index: false, follow: false },
};

export default function AdminDpiaPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <div className="mx-auto max-w-6xl">
          <PageHeader
            title="Data Protection Impact Assessment"
            description="Penilaian dampak perlindungan data pribadi (GDPR Art. 35 · UU 27/2022 PDP Pasal 34). Setiap DPIA terkait dengan sebuah aktivitas ROPA dan berisi register risiko dengan skor inherent maupun residual pasca-mitigasi."
          />
          <DpiaRegistryPanel />
        </div>
      </RequireRole>
    </RequireAuth>
  );
}
