'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useAuth } from '@/components/providers/auth-provider';

export function UserMenu(): JSX.Element | null {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  if (!user) return null;

  const initials = user.email.slice(0, 2).toUpperCase();
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
    <div className="flex items-center gap-3">
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {user.email} · <span className="font-medium">{user.role}</span>
      </span>
      <div
        aria-hidden
        className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
      >
        {initials}
      </div>
      <Link
        href="/change-password"
        className="rounded-md border border-input px-3 py-1 text-xs hover:bg-muted"
      >
        Ubah password
      </Link>
      <button
        type="button"
        onClick={onLogout}
        disabled={pending}
        className="rounded-md border border-input px-3 py-1 text-xs hover:bg-muted disabled:opacity-50"
      >
        {pending ? '...' : 'Logout'}
      </button>
    </div>
  );
}
