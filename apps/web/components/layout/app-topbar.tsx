'use client';

import { Search } from 'lucide-react';
import type { JSX } from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { Breadcrumb } from './breadcrumb';
import { MobileNav } from './mobile-nav';
import { NotificationBell } from './notification-bell';
import { UserMenu } from './user-menu';

/**
 * Sticky top bar rendered inside the main column of the app shell.
 * Left side: mobile hamburger (only visible <lg) + breadcrumb.
 * Right side: search trigger (placeholder for Fase 3 ⌘K palette) +
 * notification bell + user menu (compact avatar variant).
 *
 * Theme toggle lives inside the user menu rather than on the top
 * bar — reduces the number of always-visible controls (Notion / Vercel
 * pattern) and centralises "personal preferences" in one place.
 */
export function AppTopbar(): JSX.Element {
  return (
    <header
      className={
        'bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur lg:px-6'
      }
    >
      <div className="flex items-center gap-2">
        <MobileNav />
        <div className="hidden lg:block">
          <Breadcrumb />
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="text-muted-foreground hidden gap-2 md:flex"
            >
              <Search className="h-4 w-4" />
              <span>Cari…</span>
              <kbd className="border-border/60 bg-muted text-muted-foreground ml-4 inline-flex h-5 select-none items-center gap-0.5 rounded border px-1.5 font-mono text-[10px] font-medium">
                <span className="text-xs">⌘</span>K
              </kbd>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Command palette (segera)</TooltipContent>
        </Tooltip>

        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Cari">
          <Search />
        </Button>

        <NotificationBell />

        <UserMenu variant="compact" />
      </div>
    </header>
  );
}
