import type { Metadata } from 'next';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { ConsentHistoryPanel } from '@/components/features/privacy/consent-history-panel';
import { DataExportPanel } from '@/components/features/privacy/data-export-panel';
import { PrivacyErasurePanel } from '@/components/features/privacy/privacy-erasure-panel';

export const metadata: Metadata = {
  title: 'Privasi — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/settings/privacy` — self-service data-portability landing page.
 * Fase 31b (right-to-erasure) and 31c (retention + consent) will
 * add their own panels to this same route.
 */
export default function PrivacySettingsPage(): JSX.Element {
  return (
    <RequireAuth>
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Privasi data
          </h1>
          <p className="text-sm text-muted-foreground">
            Kelola hak akses data pribadi Anda sesuai UU Perlindungan Data
            Pribadi (UU PDP) dan praktik GDPR.
          </p>
        </div>
        <DataExportPanel />
        <div className="border-t border-input" />
        <PrivacyErasurePanel />
        <div className="border-t border-input" />
        <ConsentHistoryPanel />
      </main>
    </RequireAuth>
  );
}
