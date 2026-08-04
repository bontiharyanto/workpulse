import type { ReactNode } from 'react';

import { RequireRole } from '@/components/features/auth/require-role';

import { AdminSubnav } from './_components/admin-subnav';

export default function AdminSectionLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
      <section className="space-y-6">
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Admin</p>
          <AdminSubnav />
        </header>
        <div>{children}</div>
      </section>
    </RequireRole>
  );
}
