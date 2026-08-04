import type { Metadata } from 'next';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { RequireRole } from '@/components/features/auth/require-role';
import { WebhooksPanel } from '@/components/features/webhook/webhooks-panel';

export const metadata: Metadata = {
  title: 'Webhooks — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/admin/webhooks` — Fase 32e. HR / Super Admin surface for
 * subscribing vendor systems (payroll, BI) to lifecycle events like
 * `timesheet.export.created` and `timesheet.export.share.created`.
 */
export default function AdminWebhooksPage(): JSX.Element {
  return (
    <RequireAuth>
      <RequireRole roles={['HR_MANAGER', 'SUPER_ADMIN']}>
        <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Webhooks</h1>
            <p className="text-muted-foreground text-sm">
              Push notifikasi otomatis ke sistem eksternal (payroll, BI) saat event Workpulse
              terjadi. Setiap request ditandatangani{' '}
              <span className="font-mono text-xs">HMAC-SHA256</span> agar vendor bisa memverifikasi.
            </p>
          </div>
          <WebhooksPanel />
        </main>
      </RequireRole>
    </RequireAuth>
  );
}
