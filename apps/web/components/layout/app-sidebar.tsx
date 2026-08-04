'use client';

import type { UserRole } from '@workpulse/shared-types';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { JSX } from 'react';

import { useAuth } from '@/components/providers/auth-provider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import {
  canSeeNavItem,
  canSeeNavSection,
  navSections,
  type NavItem,
  type NavModule,
  type NavSection,
} from './nav-config';
import { UserMenu } from './user-menu';

interface AppSidebarProps {
  /**
   * When true the sidebar collapses to icon-only rail (64px wide).
   * The Fase 2 shell hard-codes expanded because we do not yet own a
   * persisted "collapsed" preference; the rail is future-proofed for
   * a Fase 3 toggle without another layout revamp.
   */
  collapsed?: boolean;
}

export function AppSidebar({ collapsed = false }: AppSidebarProps): JSX.Element {
  const { user } = useAuth();
  const role = user?.role;

  return (
    <aside
      className={cn(
        'bg-background flex h-svh shrink-0 flex-col border-r transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div
        className={cn('flex h-14 items-center border-b px-4', collapsed && 'justify-center px-0')}
      >
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span
            aria-hidden
            className="from-primary to-info text-primary-foreground shadow-xs flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br text-sm font-bold"
          >
            W
          </span>
          {!collapsed ? <span className="text-foreground tracking-tight">Workpulse</span> : null}
        </Link>
      </div>

      <ScrollArea className="flex-1 py-3">
        <nav className="flex flex-col gap-4 px-3">
          {navSections.map((section) =>
            canSeeNavSection(section, role) ? (
              <NavGroup key={section.id} section={section} role={role} collapsed={collapsed} />
            ) : null,
          )}
        </nav>
      </ScrollArea>

      <div className={cn('border-t p-2', collapsed && 'flex justify-center')}>
        <UserMenu variant={collapsed ? 'compact' : 'card'} />
      </div>
    </aside>
  );
}

interface NavGroupProps {
  section: NavSection;
  role: UserRole | undefined;
  collapsed: boolean;
}

function NavGroup({ section, role, collapsed }: NavGroupProps): JSX.Element | null {
  const visibleItems = section.items.filter((item) => canSeeNavItem(item, role));
  if (visibleItems.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {!collapsed ? (
        <h3 className="text-muted-foreground px-2 pb-1 text-[11px] font-medium uppercase tracking-wider">
          {section.label}
        </h3>
      ) : null}

      <ul className="flex flex-col gap-0.5">
        {visibleItems.map((item) => (
          <li key={item.href}>
            <NavItemLink item={item} collapsed={collapsed} />
          </li>
        ))}
      </ul>
    </div>
  );
}

interface NavItemLinkProps {
  item: NavItem;
  collapsed: boolean;
}

function NavItemLink({ item, collapsed }: NavItemLinkProps): JSX.Element {
  const pathname = usePathname();
  const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
  const moduleColor = moduleAccent(item.module);
  const Icon = item.icon;

  const inner = (
    <Link
      href={item.href as Route}
      className={cn(
        'group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
        'focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2',
        isActive
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
        collapsed && 'justify-center px-0 py-2',
      )}
      aria-current={isActive ? 'page' : undefined}
    >
      {isActive && !collapsed ? (
        <span
          aria-hidden
          className={cn(
            'absolute bottom-1.5 left-0 top-1.5 w-1 rounded-r-full',
            moduleColor.indicator,
          )}
        />
      ) : null}

      <Icon
        className={cn(
          'h-4 w-4 shrink-0 transition-colors',
          isActive ? moduleColor.iconActive : 'text-muted-foreground group-hover:text-foreground',
        )}
      />

      {!collapsed ? <span className="truncate">{item.label}</span> : null}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{inner}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    );
  }
  return inner;
}

/**
 * Map a `NavModule` to the concrete Tailwind classes for its accent
 * indicator + icon color. Keeping this in code (not the config) lets
 * `nav-config.ts` stay declarative + framework-agnostic.
 */
function moduleAccent(module: NavModule | undefined): {
  indicator: string;
  iconActive: string;
} {
  switch (module) {
    case 'attendance':
      return { indicator: 'bg-module-attendance', iconActive: 'text-module-attendance' };
    case 'leave':
      return { indicator: 'bg-module-leave', iconActive: 'text-module-leave' };
    case 'overtime':
      return { indicator: 'bg-module-overtime', iconActive: 'text-module-overtime' };
    case 'timesheet':
      return { indicator: 'bg-module-timesheet', iconActive: 'text-module-timesheet' };
    case 'admin':
      return { indicator: 'bg-module-admin', iconActive: 'text-foreground' };
    default:
      return { indicator: 'bg-primary', iconActive: 'text-primary' };
  }
}
