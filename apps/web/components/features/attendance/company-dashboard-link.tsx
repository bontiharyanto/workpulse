'use client';

import { BarChart3 } from 'lucide-react';
import Link from 'next/link';
import { type JSX } from 'react';

import { useAuth } from '@/components/providers/auth-provider';
import { Button } from '@/components/ui/button';

/**
 * Entry to the HR / company-wide dashboard. Rendered only for
 * HR_MANAGER and SUPER_ADMIN — the server would 403 anyone else,
 * so hiding the link avoids a confusing dead click.
 */
export function CompanyDashboardLink(): JSX.Element | null {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role !== 'HR_MANAGER' && user.role !== 'SUPER_ADMIN') return null;
  return (
    <Button asChild variant="outline" size="sm">
      <Link href="/attendance/dashboard">
        <BarChart3 className="h-4 w-4" aria-hidden />
        Dashboard HR
      </Link>
    </Button>
  );
}
