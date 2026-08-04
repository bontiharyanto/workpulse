'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAuth } from '@/components/providers/auth-provider';

interface Tab {
  href: Route;
  label: string;
  /**
   * Roles allowed to see this tab. When omitted, the layout's
   * `RequireRole` already covers HR_MANAGER + SUPER_ADMIN.
   */
  roles?: readonly ('HR_MANAGER' | 'SUPER_ADMIN')[];
}

const tabs: readonly Tab[] = [
  { href: '/admin/analytics' as Route, label: 'Analytics' },
  { href: '/admin/users' as Route, label: 'Karyawan' },
  { href: '/admin/departments' as Route, label: 'Departemen' },
  { href: '/admin/geofences' as Route, label: 'Geofence' },
  { href: '/admin/shifts' as Route, label: 'Shift' },
  { href: '/admin/leave-types' as Route, label: 'Tipe Cuti' },
  { href: '/admin/holidays' as Route, label: 'Hari Libur' },
  { href: '/admin/company' as Route, label: 'Konfigurasi' },
  { href: '/admin/timesheet' as Route, label: 'Timesheet' },
  { href: '/admin/reports' as Route, label: 'Laporan' },
  { href: '/admin/reports/schedules' as Route, label: 'Jadwal Laporan' },
  { href: '/admin/reports/custom' as Route, label: 'Custom Report' },
  { href: '/admin/ropa' as Route, label: 'ROPA' },
  { href: '/admin/dpia' as Route, label: 'DPIA' },
  { href: '/admin/privacy/vendors' as Route, label: 'Vendor Register' },
  { href: '/admin/security/breaches' as Route, label: 'Breach Ledger' },
  { href: '/admin/webhooks' as Route, label: 'Webhooks' },
  { href: '/admin/audit-log' as Route, label: 'Audit Log' },
  { href: '/admin/companies' as Route, label: 'Tenant', roles: ['SUPER_ADMIN'] },
];

export function AdminSubnav(): JSX.Element {
  const pathname = usePathname();
  const { user } = useAuth();
  const role = user?.role;

  const visibleTabs = tabs.filter((t) => {
    if (!t.roles) return true;
    if (role !== 'HR_MANAGER' && role !== 'SUPER_ADMIN') return false;
    return t.roles.includes(role);
  });

  return (
    <nav className="flex gap-2 border-b text-sm">
      {visibleTabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              active
                ? '-mb-px border-b-2 border-foreground px-3 py-2 font-medium'
                : '-mb-px border-b-2 border-transparent px-3 py-2 text-muted-foreground hover:text-foreground'
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
