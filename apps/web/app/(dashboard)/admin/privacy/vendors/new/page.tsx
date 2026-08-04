import { ArrowLeft } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { VendorProcessorCreateForm } from '@/components/features/privacy/vendor-processor-create-form';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Vendor / processor baru — Workpulse',
  robots: { index: false, follow: false },
};

export default function AdminVendorCreatePage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <div className="mx-auto max-w-3xl">
          <PageHeader
            title="Vendor / processor baru"
            description={
              <>
                Register akan mulai dengan status <strong>UNDER_REVIEW</strong>. Setelah DPA
                ditandatangani, vendor dapat diaktifkan.
              </>
            }
            actions={
              <Button asChild variant="outline" size="sm">
                <Link href={'/admin/privacy/vendors' as Route}>
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Register vendor
                </Link>
              </Button>
            }
          />
          <VendorProcessorCreateForm />
        </div>
      </RequireRole>
    </RequireAuth>
  );
}
