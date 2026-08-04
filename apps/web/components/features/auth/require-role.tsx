'use client';

import type { UserRole } from '@workpulse/shared-types';
import type { ReactNode } from 'react';

import { useAuth } from '@/components/providers/auth-provider';

interface Props {
  roles: readonly UserRole[];
  children: ReactNode;
}

/**
 * Client-side role gate. Renders a 403-style panel if the current user's role
 * is not in the allowed list. Assumes `RequireAuth` has already resolved the
 * session (i.e. we're inside `(dashboard)/`).
 */
export function RequireRole({ roles, children }: Props): JSX.Element {
  const { user, status } = useAuth();
  if (status !== 'authenticated' || !user) {
    return <div className="text-muted-foreground text-sm">Memuat sesi...</div>;
  }
  if (!roles.includes(user.role)) {
    return (
      <div
        role="alert"
        className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border p-4 text-sm"
      >
        Anda tidak memiliki akses ke halaman ini.
      </div>
    );
  }
  return <>{children}</>;
}
