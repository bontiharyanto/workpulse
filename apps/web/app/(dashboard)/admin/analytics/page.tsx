import type { Metadata } from 'next';

import { ExecutiveDashboard } from '@/components/features/analytics/executive-dashboard';
import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';

export const metadata: Metadata = {
  title: 'Analytics — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/admin/analytics` — Fase 33a executive KPI dashboard. Only
 * `HR_MANAGER` and `SUPER_ADMIN` may view. All aggregates are
 * tenant-scoped inside the API.
 */
export default function AdminAnalyticsPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Executive KPI Dashboard</h1>
            <p className="text-muted-foreground text-sm">
              Ringkasan operasional lintas modul: kehadiran, cuti, lembur, dan headcount. Data
              historis dari snapshot semalaman + hari ini real-time.
            </p>
          </div>
          <ExecutiveDashboard />
        </main>
      </RequireRole>
    </RequireAuth>
  );
}
