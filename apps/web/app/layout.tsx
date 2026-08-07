import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import { AuthProvider } from '@/components/providers/auth-provider';
import { QueryProvider } from '@/components/providers/query-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import './globals.css';

/**
 * CSP nonce contract — read the per-request nonce that `middleware.ts`
 * stuffs into `x-nonce`. Reading `headers()` here opts every route into
 * DYNAMIC rendering, which is required for the nonce mechanism to work:
 * a cached (static) HTML would keep the nonce it was generated with,
 * while the CSP header (set fresh per request by middleware) would carry
 * a different one — leading to `blocked:csp` on every subsequent script
 * tag. See Next.js docs on CSP + nonces:
 * https://nextjs.org/docs/app/guides/content-security-policy
 */

// Variable fonts via next/font — the woff2 files ship with the build
// so there is no runtime request to Google. `--font-sans` and
// `--font-mono` CSS variables are consumed by tailwind.config.ts.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Workpulse',
    template: '%s · Workpulse',
  },
  description: 'Enterprise Attendance System — kehadiran, cuti, lembur, timesheet.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0b' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  // Touching `headers()` forces this layout — and therefore every route
  // that inherits it — into dynamic rendering, keeping the CSP nonce in
  // sync between the CSP header and each `<script nonce="…">` tag.
  // The returned value is intentionally not stored; the side-effect is
  // what matters.
  headers();

  return (
    <html lang="id" suppressHydrationWarning className={cn(inter.variable, jetbrainsMono.variable)}>
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        <ThemeProvider>
          <QueryProvider>
            <AuthProvider>
              <TooltipProvider delayDuration={200}>
                {children}
                <Toaster />
              </TooltipProvider>
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
