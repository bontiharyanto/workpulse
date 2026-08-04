import type { Metadata , Route } from 'next';
import Link from 'next/link';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { VendorProcessorList } from '@/components/features/privacy/vendor-processor-list';

export const metadata: Metadata = {
  title: 'Register vendor / processor — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/admin/privacy/vendors` — Fase 31f. HR / Super Admin surface for
 * the Vendor / Processor Register (UU PDP Pasal 45 / GDPR Art. 28).
 * Enforced client-side by `RequireRole`; server-side by `RolesGuard`
 * on the controller.
 */
export default function AdminVendorsPage() {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">Register vendor & processor</h1>
              <p className="text-muted-foreground text-sm">
                Daftar formal pihak ketiga yang memproses data pribadi atas nama tenant, termasuk
                siklus review tahunan dan status DPA (Data Processing Agreement).
              </p>
            </div>
            <Link
              href={'/admin/privacy/vendors/new' as unknown as Route}
              className="border-border bg-primary text-primary-foreground hover:bg-primary/90 rounded-md border px-3 py-1.5 text-sm"
            >
              + Vendor baru
            </Link>
          </div>
          <VendorProcessorList />
        </main>
      </RequireRole>
    </RequireAuth>
  );
}
