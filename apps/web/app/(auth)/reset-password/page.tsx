import type { Metadata } from 'next';

import { ResetPasswordForm } from '@/components/features/auth/reset-password-form';

export const metadata: Metadata = {
  title: 'Reset password — Workpulse',
  // Reset links are single-use and sensitive — do NOT let search
  // engines index (or Referer-leak) a URL that contains a live token.
  robots: { index: false, follow: false, nocache: true },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<JSX.Element> {
  const resolved = await searchParams;
  const token = typeof resolved.token === 'string' ? resolved.token : null;
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm rounded-lg border bg-background p-6 shadow-sm">
        <div className="mb-6 space-y-1">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Workpulse
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Pilih password baru
          </h1>
          <p className="text-sm text-muted-foreground">
            Setelah menyimpan, semua sesi lama pada semua perangkat akan
            keluar otomatis.
          </p>
        </div>
        <ResetPasswordForm token={token} />
      </div>
    </main>
  );
}
