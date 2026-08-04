'use client';

import { Users } from 'lucide-react';
import Link from 'next/link';
import { type JSX } from 'react';

import { useAuth } from '@/components/providers/auth-provider';
import { Button } from '@/components/ui/button';

/**
 * "Kehadiran Tim →" entry — hidden for employees. Server-side RBAC
 * enforces access; hiding the link is just to spare non-authorized
 * roles a 403 round-trip.
 */
export function TeamAttendanceLink(): JSX.Element | null {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role !== 'SUPERVISOR' && user.role !== 'HR_MANAGER' && user.role !== 'SUPER_ADMIN') {
    return null;
  }
  return (
    <Button asChild variant="outline" size="sm">
      <Link href="/attendance/team">
        <Users className="h-4 w-4" aria-hidden />
        Kehadiran Tim
      </Link>
    </Button>
  );
}
