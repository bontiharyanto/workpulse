import type { Metadata } from 'next';

import { ForgotPasswordForm } from '@/components/features/auth/forgot-password-form';

export const metadata: Metadata = {
  title: 'Lupa password — Workpulse',
};

export default function ForgotPasswordPage(): JSX.Element {
  return (
    <main className="bg-muted/30 flex min-h-screen items-center justify-center px-4">
      <div className="bg-background w-full max-w-sm rounded-lg border p-6 shadow-sm">
        <div className="mb-6 space-y-1">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-widest">
            Workpulse
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Lupa password?</h1>
          <p className="text-muted-foreground text-sm">
            Masukkan email terdaftar dan kami akan mengirimkan link untuk memilih password baru.
          </p>
        </div>
        <ForgotPasswordForm />
      </div>
    </main>
  );
}
