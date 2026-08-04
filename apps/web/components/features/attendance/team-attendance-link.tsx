'use client';

import Link from 'next/link';

import { useAuth } from '@/components/providers/auth-provider';

/**
 * Renders the "Kehadiran Tim →" link only for roles that can see the
 * server-side team endpoints. Uses `null` render for employees so the
 * layout doesn't leave a gap where the button would be.
 */
export function TeamAttendanceLink(): JSX.Element | null {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role !== 'SUPERVISOR' && user.role !== 'HR_MANAGER' && user.role !== 'SUPER_ADMIN') {
    return null;
  }
  return (
    <Link
      href="/attendance/team"
      className="border-input hover:bg-muted whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-medium"
    >
      Kehadiran Tim →
    </Link>
  );
}
