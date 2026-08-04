'use client';

import { usePathname } from 'next/navigation';
import type { JSX, ReactNode } from 'react';

import { PageTransition } from '@/components/motion/motion-primitives';

/**
 * Wraps the `<main>` region of the dashboard shell in a
 * pathname-keyed transition so the page fades + rises subtly on
 * every route change. Split out from `(dashboard)/layout.tsx` so
 * that layout can remain a server component (RequireAuth + shell
 * are cheap on the server); this file owns the tiny client hook
 * chain (`usePathname` + framer-motion).
 */
export function DashboardMain({ children }: { children: ReactNode }): JSX.Element {
  const pathname = usePathname();

  return (
    <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
      <div className="mx-auto w-full max-w-7xl">
        <PageTransition routeKey={pathname}>{children}</PageTransition>
      </div>
    </main>
  );
}
