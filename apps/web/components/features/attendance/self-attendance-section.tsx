'use client';

import { BarChart3, Building2, ShieldCheck, Users } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { JSX } from 'react';

import { useAuth } from '@/components/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { ClockPanel } from './clock-panel';
import { MonthlySummaryWidget } from './monthly-summary-widget';

/**
 * Attendance is an *employee* action. `SUPER_ADMIN` accounts are
 * cross-tenant and have no shift, geofence, or department, so the
 * backend rejects `POST /attendance/clock-in` and `GET /attendance/me/*`
 * with 403 (see `@Roles` guards in `attendance.controller.ts`).
 *
 * Rendering the ClockPanel / MonthlySummaryWidget for a Super Admin
 * would surface a generic "Anda tidak memiliki akses" error that is
 * misleading — the account is not *denied*, it is simply the wrong
 * subject for this action. This wrapper substitutes a callout that
 * funnels the admin to the surfaces built for their role.
 *
 * All other roles (`EMPLOYEE`, `SUPERVISOR`, `HR_MANAGER`) get the
 * normal self-service kehadiran experience.
 */
export function SelfAttendanceSection(): JSX.Element {
  const { user, status } = useAuth();

  if (status === 'loading') {
    return (
      <>
        <ClockPanel />
        <MonthlySummaryWidget />
      </>
    );
  }

  if (user?.role === 'SUPER_ADMIN') {
    return <SuperAdminCallout />;
  }

  return (
    <>
      <ClockPanel />
      <MonthlySummaryWidget />
    </>
  );
}

function SuperAdminCallout(): JSX.Element {
  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <div className="text-info text-overline flex items-center gap-2 uppercase tracking-widest">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          <span>Peran administrator</span>
        </div>
        <CardTitle className="text-h4">Akun Super Admin tidak melakukan clock-in</CardTitle>
        <CardDescription>
          Kehadiran adalah aksi yang dilakukan karyawan pada shift &amp; geofence tertentu. Akun
          Super Admin bersifat lintas tenant dan tidak terikat pada salah satu. Gunakan salah satu
          surface administrator di bawah untuk memantau kehadiran perusahaan atau tim.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button asChild variant="default" size="sm">
          <Link href={'/attendance/dashboard' as Route}>
            <BarChart3 className="h-4 w-4" aria-hidden />
            Dashboard HR
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={'/attendance/team' as Route}>
            <Users className="h-4 w-4" aria-hidden />
            Kehadiran Tim
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={'/admin/analytics' as Route}>
            <BarChart3 className="h-4 w-4" aria-hidden />
            Executive Dashboard
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={'/admin/companies' as Route}>
            <Building2 className="h-4 w-4" aria-hidden />
            Kelola Tenant
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
