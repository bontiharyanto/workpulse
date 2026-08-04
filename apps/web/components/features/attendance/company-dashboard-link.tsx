'use client';

import Link from 'next/link';

import { useAuth } from '@/components/providers/auth-provider';

/**
 * Entry point to the HR / company-wide attendance dashboard. Rendered
 * only for HR and Super Admin — RBAC on the server refuses everyone
 * else anyway, but hiding the link keeps supervisors from wondering
 * why the URL 403's for them.
 */
export function CompanyDashboardLink(): JSX.Element | null {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role !== 'HR_MANAGER' && user.role !== 'SUPER_ADMIN') return null;
  return (
    <Link
      href="/attendance/dashboard"
      className="border-input hover:bg-muted whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-medium"
    >
      Dashboard HR →
    </Link>
  );
}
