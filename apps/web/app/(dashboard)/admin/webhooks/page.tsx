import type { Metadata } from 'next';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { WebhooksPanel } from '@/components/features/webhook/webhooks-panel';
import { PageHeader } from '@/components/layout/page-header';

export const metadata: Metadata = {
  title: 'Webhooks — Workpulse',
  robots: { index: false, follow: false },
};

export default function AdminWebhooksPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <div className="mx-auto max-w-6xl">
          <PageHeader
            title="Webhooks"
            description={
              <>
                Push notifikasi otomatis ke sistem eksternal (payroll, BI) saat event Workpulse
                terjadi. Setiap request ditandatangani{' '}
                <span className="font-mono text-xs">HMAC-SHA256</span> agar vendor dapat
                memverifikasi.
              </>
            }
          />
          <WebhooksPanel />
        </div>
      </RequireRole>
    </RequireAuth>
  );
}
