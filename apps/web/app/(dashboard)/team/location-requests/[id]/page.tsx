import type { Metadata } from 'next';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { LocationRequestSupervisorDetail } from '@/components/features/location-sharing/location-request-supervisor-detail';
import { PageHeader } from '@/components/layout/page-header';

export const metadata: Metadata = {
  title: 'Detail Permintaan Lokasi — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/team/location-requests/[id]` — supervisor's view of a single
 * request. Server-side `viewRequest` fires the transparency
 * notification when the coord is fetched (see ADR-0041 §Notifications
 * — every view notifies the target).
 */
export default async function LocationRequestDetailPage({
  params,
}: {
  // Next.js 15 dynamic-segment `params` is a Promise — await once at
  // the top of the server component; the panel expects a plain string.
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  return (
    <RequireAuth>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Detail permintaan lokasi"
          description="Membuka halaman ini akan memberi tahu karyawan bahwa Anda melihat koordinat mereka. Setiap akses tercatat di audit log."
        />
        <LocationRequestSupervisorDetail requestId={id} />
      </div>
    </RequireAuth>
  );
}
