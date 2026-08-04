import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AuthProvider } from '@/components/providers/auth-provider';
import { QueryProvider } from '@/components/providers/query-provider';

import './globals.css';

export const metadata: Metadata = {
  title: 'Workpulse',
  description: 'Enterprise Attendance System',
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="id" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <QueryProvider>
          <AuthProvider>{children}</AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
