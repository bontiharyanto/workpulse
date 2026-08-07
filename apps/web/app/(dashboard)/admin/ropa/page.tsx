import type { Metadata } from 'next';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { RopaRegistryPanel } from '@/components/features/ropa/ropa-registry-panel';
import { PageHeader } from '@/components/layout/page-header';

export const metadata: Metadata = {
  title: 'ROPA — Workpulse',
  robots: { index: false, follow: false },
};

export default function AdminRopaPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <div className="mx-auto max-w-4xl">
          <PageHeader
            title="Record of Processing Activities"
            description="Register kegiatan pemrosesan data pribadi (Pasal 31 UU 27/2022 PDP; GDPR Art. 30). Setiap perubahan tercatat di audit log — regulator boleh me-request PDF/XLSX kapan pun."
          />
          <RopaRegistryPanel />
        </div>
      </RequireRole>
    </RequireAuth>
  );
}
