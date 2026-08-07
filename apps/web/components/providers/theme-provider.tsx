'use client';

import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from 'next-themes';
import type { JSX } from 'react';

/**
 * Thin wrapper around `next-themes` so consumers do not import the
 * third-party API directly (keeps swap-out cheap if we ever migrate).
 *
 * `attribute="class"` toggles the `.dark` class on <html> — the
 * pattern globals.css and Tailwind's `darkMode: ['class']` agree on.
 *
 * `defaultTheme="system"` respects the OS preference on first visit;
 * user can override via the ThemeToggle in the app shell.
 *
 * `disableTransitionOnChange` prevents the paint flash when switching
 * themes at runtime (would otherwise animate every colored surface).
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps): JSX.Element {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
