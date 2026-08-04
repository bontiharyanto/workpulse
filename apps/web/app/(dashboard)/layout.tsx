import Link from 'next/link';
import type { ReactNode } from 'react';

import { NavLinks } from '@/components/features/auth/nav-links';
import { RequireAuth } from '@/components/features/auth/require-auth';
import { UserMenu } from '@/components/features/auth/user-menu';
import { NotificationBell } from '@/components/features/notifications/notification-bell';

export default function DashboardLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <RequireAuth>
      <div className="flex min-h-screen flex-col">
        <header className="border-b bg-background">
          <div className="container flex h-14 items-center justify-between">
            <Link href="/" className="font-semibold">
              Workpulse
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <NavLinks />
              <NotificationBell />
              <UserMenu />
            </nav>
          </div>
        </header>
        <main className="container flex-1 py-8">{children}</main>
      </div>
    </RequireAuth>
  );
}
