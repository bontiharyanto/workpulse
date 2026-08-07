import type { Metadata } from 'next';
import type { JSX } from 'react';

import { AuthShell } from '@/components/features/auth/auth-shell';
import { ResetPasswordForm } from '@/components/features/auth/reset-password-form';

export const metadata: Metadata = {
  title: 'Reset password — Workpulse',
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
    <AuthShell
      title="Pilih password baru"
      description="Setelah menyimpan, semua sesi lama pada semua perangkat akan keluar otomatis."
    >
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
