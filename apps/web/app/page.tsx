'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '@/components/providers/auth-provider';

export default function HomePage(): JSX.Element {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authenticated') router.replace('/attendance');
    else if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

  return (
    <main className="text-muted-foreground flex min-h-screen items-center justify-center text-sm">
      Memuat...
    </main>
  );
}
