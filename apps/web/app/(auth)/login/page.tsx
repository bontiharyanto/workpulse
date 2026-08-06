import { CheckCircle2 } from 'lucide-react';
import type { Metadata } from 'next';
import type { JSX } from 'react';

import { AuthShell } from '@/components/features/auth/auth-shell';
import { LoginForm } from '@/components/features/auth/login-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export const metadata: Metadata = {
  title: 'Masuk — Workpulse',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; changed?: string }>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const justChanged = params.changed === '1';
  return (
    <AuthShell
      title="Masuk ke akun Anda"
      description="Gunakan email perusahaan dan kata sandi."
      brandCentered
      brandSubtitle="klikhadir.site"
    >
      {justChanged ? (
        <Alert variant="success" role="status">
          <CheckCircle2 aria-hidden />
          <AlertTitle>Password berhasil diubah</AlertTitle>
          <AlertDescription>
            Silakan masuk kembali dengan password baru Anda.
          </AlertDescription>
        </Alert>
      ) : null}
      <LoginForm redirectTo={params.next ?? '/attendance'} />
    </AuthShell>
  );
}
