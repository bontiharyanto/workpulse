import type { Metadata } from 'next';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { RopaActivityDetailPanel } from '@/components/features/ropa/ropa-activity-detail-panel';

export const metadata: Metadata = {
  title: 'ROPA — Aktivitas',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ activityId: string }>;
}

export default async function AdminRopaActivityPage({
  params,
}: PageProps): Promise<JSX.Element> {
  const { activityId } = await params;
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
          <RopaActivityDetailPanel activityId={activityId} />
        </main>
      </RequireRole>
    </RequireAuth>
  );
}
