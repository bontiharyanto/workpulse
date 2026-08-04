'use client';

import { ChevronRight, Home } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment, useMemo, type JSX } from 'react';

import { labelForSegment } from './nav-config';

/**
 * Auto-generated breadcrumb from the current URL. No configuration
 * needed at the page level; segment → label mapping lives in
 * `nav-config.ts::segmentLabels` for anything that needs a friendlier
 * name than `Title Case`.
 *
 * Route-group segments (Next.js parentheses like `(dashboard)`) never
 * appear in `usePathname()` output, so we do not have to strip them.
 * Dynamic segments (`[id]`, `[activityId]`) do surface as the raw
 * value, so a longer UUID will show; a future PR can look up display
 * labels via a React Query cache — punted intentionally.
 */
export function Breadcrumb(): JSX.Element {
  const pathname = usePathname();

  const parts = useMemo(() => {
    const segments = pathname.split('/').filter(Boolean);
    // Progressively build up the href for each segment so each crumb
    // is clickable. `/attendance/history` yields:
    //   [
    //     { href: '/attendance', label: 'Kehadiran' },
    //     { href: '/attendance/history', label: 'Riwayat' },
    //   ]
    return segments.map((seg, idx) => ({
      href: '/' + segments.slice(0, idx + 1).join('/'),
      label: labelForSegment(seg),
      isLast: idx === segments.length - 1,
    }));
  }, [pathname]);

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      <Link
        href="/"
        className="text-muted-foreground hover:text-foreground flex items-center transition-colors"
        aria-label="Beranda"
      >
        <Home className="h-4 w-4" />
      </Link>

      {parts.map((part) => (
        <Fragment key={part.href}>
          <ChevronRight className="text-muted-foreground/50 h-4 w-4" aria-hidden />
          {part.isLast ? (
            <span className="text-foreground font-medium">{part.label}</span>
          ) : (
            <Link
              href={part.href as Route}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {part.label}
            </Link>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
