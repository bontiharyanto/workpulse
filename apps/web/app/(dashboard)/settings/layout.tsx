import type { JSX, ReactNode } from 'react';

import { PageHeader } from '@/components/layout/page-header';

import { SettingsNav } from './_components/settings-nav';

/**
 * Shared shell for `/settings/*` — a settings-style layout with a
 * vertical navigation column on `lg+` and a horizontal chip strip
 * below the page header on smaller viewports.
 *
 * Sub-pages own their inner `<section>` structure and card contents;
 * this layout only wires the shell.
 */
export default function SettingsLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Pengaturan"
        description="Kelola preferensi personal Anda: keamanan akun, notifikasi, dan hak atas data pribadi."
      />
      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside>
          <SettingsNav />
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}
