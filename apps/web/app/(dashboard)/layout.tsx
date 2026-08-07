import type { ReactNode } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { AppTopbar } from '@/components/layout/app-topbar';
import { DashboardMain } from '@/components/layout/dashboard-main';

/**
 * Application shell for every authenticated route.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────┐
 *   │  Sidebar  │  Topbar (sticky)                   │
 *   │  (fixed)  │────────────────────────────────────│
 *   │           │                                    │
 *   │           │  <main>...page content...</main>   │
 *   │           │                                    │
 *   └────────────────────────────────────────────────┘
 *
 * Sidebar is hidden below the `lg` breakpoint; the MobileNav sheet
 * inside the topbar replaces it. Content column stretches to the
 * viewport height so pages can implement their own inner scrolling
 * without stacked scrollbars.
 *
 * `DashboardMain` is a thin client component that owns the page
 * transition motion — kept separate so this layout can stay a pure
 * server component (better streaming, cheaper hydration).
 */
export default function DashboardLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <RequireAuth>
      <div className="bg-background flex min-h-svh">
        <div className="sticky top-0 hidden h-svh lg:block">
          <AppSidebar />
        </div>

        <div className="flex min-h-svh flex-1 flex-col">
          <AppTopbar />
          <DashboardMain>{children}</DashboardMain>
        </div>
      </div>
    </RequireAuth>
  );
}
