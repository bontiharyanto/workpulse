'use client';

import { Bell, ShieldCheck, ShieldQuestion, UserRound, type LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { JSX } from 'react';

import { cn } from '@/lib/utils';

const ITEMS: Array<{
  href: Route;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    href: '/settings/profile' as Route,
    label: 'Profil',
    description: 'Identitas akun & data personal',
    icon: UserRound,
  },
  {
    href: '/settings/security' as Route,
    label: 'Keamanan',
    description: 'Verifikasi 2 langkah & sesi aktif',
    icon: ShieldCheck,
  },
  {
    href: '/settings/notifications' as Route,
    label: 'Notifikasi',
    description: 'Preferensi in-app & email',
    icon: Bell,
  },
  {
    href: '/settings/privacy' as Route,
    label: 'Privasi data',
    description: 'Export, hapus, riwayat consent',
    icon: ShieldQuestion,
  },
];

/**
 * Vertical navigation for `/settings/*`. Renders as a sticky
 * side-column on `lg+`, and collapses to a horizontal chip strip
 * on smaller viewports.
 */
export function SettingsNav(): JSX.Element {
  const pathname = usePathname();

  return (
    <nav aria-label="Pengaturan" className="lg:sticky lg:top-6">
      <ul className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1 lg:overflow-visible">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <li key={item.href} className="min-w-max lg:min-w-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'text-body group flex items-center gap-3 rounded-md border px-3 py-2 transition-colors',
                  active
                    ? 'bg-primary/5 border-primary/30 text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground border-transparent',
                )}
              >
                <Icon
                  aria-hidden
                  className={cn(
                    'h-4 w-4 shrink-0',
                    active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
                  )}
                />
                <div className="min-w-0">
                  <p className="text-body truncate font-medium">{item.label}</p>
                  <p className="text-muted-foreground text-caption hidden truncate lg:block">
                    {item.description}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
