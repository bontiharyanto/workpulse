'use client';

import type { Route } from 'next';
import Link from 'next/link';

import { useAuth } from '@/components/providers/auth-provider';

export function NavLinks(): JSX.Element | null {
  const { user } = useAuth();
  if (!user) return null;

  const canApprove = user.role !== 'EMPLOYEE';
  const canAdmin = user.role === 'HR_MANAGER' || user.role === 'SUPER_ADMIN';

  return (
    <>
      <Link href="/attendance" className="text-muted-foreground hover:text-foreground">
        Kehadiran
      </Link>
      <Link href="/leave" className="text-muted-foreground hover:text-foreground">
        Cuti
      </Link>
      <Link href="/overtime" className="text-muted-foreground hover:text-foreground">
        Lembur
      </Link>
      <Link href={'/me/timesheet' as Route} className="text-muted-foreground hover:text-foreground">
        Timesheet
      </Link>
      {canApprove && (
        <Link href="/leave/approvals" className="text-muted-foreground hover:text-foreground">
          Approval Cuti
        </Link>
      )}
      {canApprove && (
        <Link href="/overtime/approvals" className="text-muted-foreground hover:text-foreground">
          Approval Lembur
        </Link>
      )}
      {canAdmin && (
        <Link href="/admin/users" className="text-muted-foreground hover:text-foreground">
          Admin
        </Link>
      )}
      <Link href="/settings/notifications" className="text-muted-foreground hover:text-foreground">
        Notifikasi
      </Link>
    </>
  );
}
