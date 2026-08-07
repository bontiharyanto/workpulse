import type { Metadata } from 'next';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { LocationShareRespondPanel } from '@/components/features/location-sharing/location-share-respond-panel';
import { PageHeader } from '@/components/layout/page-header';

export const metadata: Metadata = {
  title: 'Permintaan lokasi — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/me/location-sharing/inbox/[id]` — landing target for the
 * push / bell / email link fired when a supervisor asks for the
 * user's current coordinates. Renders the ADR-0041 accept/decline
 * modal.
 *
 * The route is authenticated + user-scoped: server rejects
 * the response with 404 if the caller isn't the request target.
 */
export default async function LocationShareInboxPage({
  params,
}: {
  // Next.js 15 changed dynamic-segment params to a Promise so RSC
  // can stream them. Await once at the top; downstream props stay
  // regular strings.
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  return (
    <RequireAuth>
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title="Permintaan berbagi lokasi"
          description="Anda dapat menerima atau menolak. Setiap keputusan tercatat sebagai bukti bahwa lokasi hanya dibagikan atas persetujuan Anda."
        />
        <LocationShareRespondPanel requestId={id} />
      </div>
    </RequireAuth>
  );
}
