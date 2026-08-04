'use client';

import type { AuthenticatedUser } from '@workpulse/shared-types';
import { ChevronsUpDown, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useState, type JSX } from 'react';

import { useAuth } from '@/components/providers/auth-provider';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { userMenuItems } from './nav-config';

interface UserMenuProps {
  /**
   * When true the trigger renders a full card (avatar + email + role +
   * chevron) suitable for the sidebar footer. When false, it renders
   * only the round avatar — the compact form for the top bar / mobile
   * header.
   */
  variant?: 'card' | 'compact';
  className?: string;
}

export function UserMenu({ variant = 'card', className }: UserMenuProps): JSX.Element | null {
  const { user, logout } = useAuth();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [pending, setPending] = useState(false);

  if (!user) return null;

  const onLogout = async (): Promise<void> => {
    setPending(true);
    try {
      await logout();
      router.replace('/login');
    } finally {
      setPending(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === 'card' ? (
          <button
            type="button"
            className={cn(
              'hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-2 rounded-lg p-2 text-left transition-colors focus:outline-none focus-visible:ring-2',
              className,
            )}
          >
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initialsOf(user)}</AvatarFallback>
            </Avatar>
            <div className="flex flex-1 flex-col text-left leading-tight">
              <span className="text-foreground truncate text-sm font-medium">{user.email}</span>
              <span className="text-muted-foreground text-[11px] uppercase tracking-wide">
                {readableRole(user.role)}
              </span>
            </div>
            <ChevronsUpDown className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Menu pengguna"
            className={cn(
              'focus-visible:ring-ring rounded-full transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2',
              className,
            )}
          >
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initialsOf(user)}</AvatarFallback>
            </Avatar>
          </button>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64" sideOffset={8}>
        <DropdownMenuLabel className="flex items-start gap-2 px-2 py-2 font-normal">
          <Avatar className="h-9 w-9">
            <AvatarFallback>{initialsOf(user)}</AvatarFallback>
          </Avatar>
          <div className="flex flex-1 flex-col leading-tight">
            <span className="text-foreground text-sm font-medium">{user.email}</span>
            <div className="mt-1 flex items-center gap-1.5">
              <Badge variant="muted" className="text-[10px]">
                {readableRole(user.role)}
              </Badge>
              {user.mfaEnabled ? (
                <Badge variant="success" className="text-[10px]">
                  MFA aktif
                </Badge>
              ) : null}
            </div>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          {userMenuItems.map((item) => (
            <DropdownMenuItem key={item.href} asChild>
              <Link href={item.href as Route}>
                <item.icon />
                <span>{item.label}</span>
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {theme === 'dark' ? <Moon /> : theme === 'light' ? <Sun /> : <Monitor />}
            <span>Tema</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={() => setTheme('light')}>
              <Sun /> Terang
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('dark')}>
              <Moon /> Gelap
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('system')}>
              <Monitor /> Ikuti sistem
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => void onLogout()}
          disabled={pending}
          className="text-destructive focus:text-destructive"
        >
          <LogOut />
          <span>{pending ? 'Logging out…' : 'Keluar'}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function initialsOf(user: AuthenticatedUser): string {
  const source = user.email.split('@')[0] ?? user.email;
  const parts = source.split(/[._-]/).filter(Boolean);
  const first = parts[0];
  const second = parts[1];
  if (first !== undefined && second !== undefined) {
    return (first.charAt(0) + second.charAt(0)).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function readableRole(role: AuthenticatedUser['role']): string {
  switch (role) {
    case 'EMPLOYEE':
      return 'Karyawan';
    case 'SUPERVISOR':
      return 'Supervisor';
    case 'HR_MANAGER':
      return 'HR Manager';
    case 'SUPER_ADMIN':
      return 'Super Admin';
    default:
      return role;
  }
}
