import type { Metadata } from 'next';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { ConsentHistoryPanel } from '@/components/features/privacy/consent-history-panel';
import { DataExportPanel } from '@/components/features/privacy/data-export-panel';
import { LocationSharingConsentPanel } from '@/components/features/privacy/location-sharing-consent-panel';
import { PrivacyErasurePanel } from '@/components/features/privacy/privacy-erasure-panel';
import { Separator } from '@/components/ui/separator';

export const metadata: Metadata = {
  title: 'Privasi — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * `/settings/privacy` — self-service data-portability landing page.
 * Fase 31b (right-to-erasure) and 31c (retention + consent) contribute
 * their own panels to this same route.
 */
export default function PrivacySettingsPage(): JSX.Element {
  return (
    <RequireAuth>
      <div className="space-y-6">
        <header className="space-y-1">
          <h2 className="text-h4 text-foreground tracking-tight">Privasi data</h2>
          <p className="text-muted-foreground text-body">
            Kelola hak akses data pribadi Anda sesuai UU Perlindungan Data Pribadi (UU PDP) dan
            praktik GDPR.
          </p>
        </header>
        <DataExportPanel />
        <Separator />
        <PrivacyErasurePanel />
        <Separator />
        <LocationSharingConsentPanel />
        <Separator />
        <ConsentHistoryPanel />
      </div>
    </RequireAuth>
  );
}
