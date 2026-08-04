import type { Metadata } from 'next';

import { LoginForm } from '@/components/features/auth/login-form';

export const metadata: Metadata = {
  title: 'Masuk — Workpulse',
};

export default async function LoginPage({
  searchParams,
}: {
  // Next.js 15 turned this into an async property. `next` carries the
  // post-login redirect target; `changed=1` is set by the change-password
  // flow to surface a success toast.
  searchParams: Promise<{ next?: string; changed?: string }>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const justChanged = params.changed === '1';
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm rounded-lg border bg-background p-6 shadow-sm">
        <div className="mb-6 space-y-1">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Workpulse
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Masuk ke akun Anda</h1>
          <p className="text-sm text-muted-foreground">
            Gunakan email perusahaan dan kata sandi.
          </p>
        </div>
        {justChanged && (
          <div
            role="status"
            className="mb-4 rounded-md border border-emerald-300/60 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
          >
            Password berhasil diubah. Silakan masuk kembali dengan password
            baru Anda.
          </div>
        )}
        <LoginForm redirectTo={params.next ?? '/attendance'} />
      </div>
    </main>
  );
}
