import type { Metadata } from 'next';
import type { JSX } from 'react';

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

export default async function AdminVendorDetailPage({ params }: Params): Promise<JSX.Element> {
  const { id } = await params;
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <div className="mx-auto max-w-5xl">
          <VendorProcessorDetail vendorId={id} />
        </div>
      </RequireRole>
    </RequireAuth>
  );
}
