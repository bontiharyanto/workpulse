import type { Metadata } from 'next';
import type { JSX } from 'react';

import { AuthShell } from '@/components/features/auth/auth-shell';
import { ForgotPasswordForm } from '@/components/features/auth/forgot-password-form';

export const metadata: Metadata = {
  title: 'Lupa password — Workpulse',
};

export default function ForgotPasswordPage(): JSX.Element {
  return (
    <AuthShell
      title="Lupa password?"
      description="Masukkan email terdaftar dan kami akan mengirimkan link untuk memilih password baru."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
