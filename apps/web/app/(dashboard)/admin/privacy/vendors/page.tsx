import { Plus } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { VendorProcessorList } from '@/components/features/privacy/vendor-processor-list';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Register vendor / processor — Workpulse',
  robots: { index: false, follow: false },
};

export default function AdminVendorsPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <div className="mx-auto max-w-6xl">
          <PageHeader
            title="Register vendor & processor"
            description="Daftar formal pihak ketiga yang memproses data pribadi atas nama tenant, termasuk siklus review tahunan dan status DPA (Data Processing Agreement)."
            actions={
              <Button asChild size="sm">
                <Link href={'/admin/privacy/vendors/new' as Route}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Vendor baru
                </Link>
              </Button>
            }
          />
          <VendorProcessorList />
        </div>
      </RequireRole>
    </RequireAuth>
  );
}
