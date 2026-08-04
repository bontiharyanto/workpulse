import type { Metadata } from 'next';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { VendorProcessorCreateForm } from '@/components/features/privacy/vendor-processor-create-form';

export const metadata: Metadata = {
  title: 'Vendor / processor baru — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/admin/privacy/vendors/new` — Fase 31f. Empty-state form to create
 * a fresh vendor row. Vendor starts in `UNDER_REVIEW` and only flips
 * to `ACTIVE` once the DPA is countersigned.
 */
export default function AdminVendorCreatePage() {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Vendor / processor baru</h1>
            <p className="text-muted-foreground text-sm">
              Register akan mulai dengan status <strong>UNDER_REVIEW</strong>. Setelah DPA
              ditandatangani, vendor dapat diaktifkan.
            </p>
          </div>
          <VendorProcessorCreateForm />
        </main>
      </RequireRole>
    </RequireAuth>
  );
}
