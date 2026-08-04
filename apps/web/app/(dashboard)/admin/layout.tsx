import type { ReactNode } from 'react';

import { RequireRole } from '@/components/features/auth/require-role';

/**
 * Admin section wrapper. Historically this used to render an
 * `AdminSubnav` horizontal tab bar (19 tabs across the top), but
 * Fase 2 of the UI redesign consolidated all admin routes into the
 * left sidebar's topical sections (Data Master, Analytics & Laporan,
 * Timesheet Admin, Compliance, System). Keeping BOTH would surface
 * every admin page twice, so the horizontal bar is dropped.
 *
 * The `RequireRole` guard remains — it is the ONLY thing that gates
 * access to the entire admin subtree in the client. Server-side
 * `RolesGuard` on every controller stays as the source of truth for
 * authorization (this UI guard is defence-in-depth).
 *
 * The stale file at `_components/admin-subnav.tsx` is retained on
 * disk during Fase 2 to avoid a large deletion diff mid-migration;
 * Fase 3 removes it once the E2E suite is green against the new
 * sidebar-driven nav.
 */
export default function AdminSectionLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
      <div>{children}</div>
    </RequireRole>
  );
}
