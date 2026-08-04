import type { Metadata } from 'next';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { RopaRegistryPanel } from '@/components/features/ropa/ropa-registry-panel';

export const metadata: Metadata = {
  title: 'ROPA — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/admin/ropa` — Fase 31d landing page for the Record of Processing
 * Activities registry. Only `HR_MANAGER` and `SUPER_ADMIN` may view.
 */
export default function AdminRopaPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Record of Processing Activities
            </h1>
            <p className="text-muted-foreground text-sm">
              Register kegiatan pemrosesan data pribadi (Pasal 31 UU 27/2022 PDP; GDPR Art. 30).
              Setiap perubahan tercatat di audit log — regulator boleh me-request PDF/XLSX kapan
              pun.
            </p>
          </div>
          <RopaRegistryPanel />
        </main>
      </RequireRole>
    </RequireAuth>
  );
}
