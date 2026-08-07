import type { Metadata } from 'next';
import type { JSX } from 'react';

import { AuthShell } from '@/components/features/auth/auth-shell';
import { MfaVerifyForm } from '@/components/features/auth/mfa-verify-form';

export const metadata: Metadata = {
  title: 'Verifikasi MFA — Workpulse',
  robots: { index: false, follow: false },
};

/**
 * Second-factor page. Reachable only mid-login (pre-MFA session).
 * `<MfaVerifyForm>` itself bounces the user to `/attendance` if the
 * store shows a fully-verified session — so a direct bookmark hit
 * after login completion never traps the user here.
 *
 * `<RequireAuth>` is intentionally NOT wrapped around this page: the
 * caller here is authenticated but with `mfaPassed=false`, which
 * RequireAuth would treat as "redirect to /login/mfa" — an infinite
 * loop back to this same page.
 */
export default async function MfaVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  return (
    <AuthShell
      title="Verifikasi 2 langkah"
      description="Masukkan kode dari aplikasi authenticator atau backup code untuk melanjutkan."
    >
      <MfaVerifyForm redirectTo={params.next ?? '/attendance'} />
    </AuthShell>
  );
}
