'use client';

import { useTheme } from 'next-themes';
import type { JSX } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * Toast surface backed by `sonner`. Colored variants come free
 * (`toast.success(...)`, `toast.error(...)`) and honour our theme
 * tokens because we pass `theme` from `next-themes` and let sonner
 * pick the CSS variables from our design system.
 *
 * Positioned bottom-right by default — right side is the safest
 * corner for a mostly-LTR layout with an app shell whose primary
 * action is up-top.
 */
export function Toaster({ ...props }: ToasterProps): JSX.Element {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  );
}
