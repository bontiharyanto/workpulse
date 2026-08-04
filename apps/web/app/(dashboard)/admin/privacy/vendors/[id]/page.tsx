import type { Metadata } from 'next';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { VendorProcessorDetail } from '@/components/features/privacy/vendor-processor-detail';

export const metadata: Metadata = {
  title: 'Detail vendor / processor — Workpulse',
  robots: { index: false, follow: false },
};

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * `/admin/privacy/vendors/[id]` — Fase 31f. Detail page with edit,
 * mark-reviewed, terminate, and ROPA link management.
 */
export default async function AdminVendorDetailPage({ params }: Params) {
  const { id } = await params;
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
          <VendorProcessorDetail vendorId={id} />
        </main>
      </RequireRole>
    </RequireAuth>
  );
}
