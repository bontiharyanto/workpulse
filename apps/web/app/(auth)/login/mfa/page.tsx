import type { Metadata } from 'next';

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
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm rounded-lg border bg-background p-6 shadow-sm">
        <div className="mb-6 space-y-1">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Workpulse
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Verifikasi 2 langkah</h1>
          <p className="text-sm text-muted-foreground">
            Masukkan kode dari aplikasi authenticator atau backup code
            untuk melanjutkan.
          </p>
        </div>
        <MfaVerifyForm redirectTo={params.next ?? '/attendance'} />
      </div>
    </main>
  );
}
