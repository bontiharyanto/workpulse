import type { Metadata } from 'next';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { LocationRequestsSupervisorPanel } from '@/components/features/location-sharing/location-requests-supervisor-panel';
import { PageHeader } from '@/components/layout/page-header';

export const metadata: Metadata = {
  title: 'Permintaan Lokasi — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/team/location-requests` — supervisor dashboard for the
 * ADR-0041 location-sharing feature. Two panes:
 *
 *   1. Outgoing history (last 25) — status + who + when.
 *   2. "New request" form — pick a subordinate + reason.
 *
 * Employees never land here (server enforces role); the nav
 * hides the link from non-supervisors.
 */
export default function LocationRequestsPage(): JSX.Element {
  return (
    <RequireAuth>
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title="Permintaan Lokasi"
          description="Kirim satu permintaan lokasi kepada karyawan lapangan Anda. Karyawan wajib memberi persetujuan tiap permintaan, dan sistem memberi tahu mereka setiap kali Anda melihat koordinatnya."
        />
        <LocationRequestsSupervisorPanel />
      </div>
    </RequireAuth>
  );
}
