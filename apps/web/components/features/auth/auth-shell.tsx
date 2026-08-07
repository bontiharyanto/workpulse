import type { JSX, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Consistent visual shell for every unauthenticated route (login,
 * MFA verify, forgot / reset password, MFA enrollment, consent).
 *
 * The shell renders:
 *  - A centered, elevated card with the Workpulse wordmark eyebrow.
 *  - A title (h1) + optional description slot.
 *  - The form body as `children`.
 *  - An optional footer slot for secondary navigation (e.g. "back to login").
 *
 * Kept as a Server Component: it never reads state and its styling is
 * fully declarative. All auth forms below it are Client Components.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
  size = 'sm',
  className,
  brandCentered = false,
  brandSubtitle,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Center the Workpulse wordmark (used on the primary login screen). */
  brandCentered?: boolean;
  /** Optional line under the wordmark, e.g. product domain. */
  brandSubtitle?: string;
}): JSX.Element {
  const maxWidth = size === 'lg' ? 'max-w-2xl' : size === 'md' ? 'max-w-lg' : 'max-w-sm';
  return (
    <main className="bg-muted/30 flex min-h-screen items-center justify-center px-4 py-10">
      <div
        className={cn(
          'bg-background border-border w-full space-y-6 rounded-xl border p-6 shadow-md sm:p-8',
          maxWidth,
          className,
        )}
      >
        <div className={cn('space-y-2', brandCentered && 'text-center')}>
          <div className={cn(brandCentered && 'space-y-1')}>
            <p
              className={cn(
                'text-foreground text-overline font-semibold uppercase tracking-widest',
                brandCentered && 'text-h4 tracking-[0.2em]',
              )}
            >
              Workpulse
            </p>
            {brandSubtitle ? (
              <p className="text-muted-foreground text-caption tracking-wide">{brandSubtitle}</p>
            ) : null}
          </div>
          <h1 className="text-h3 text-foreground tracking-tight">{title}</h1>
          {description ? (
            <div className="text-muted-foreground text-body">{description}</div>
          ) : null}
        </div>
        <div className="space-y-4">{children}</div>
        {footer ? <div className="border-border/60 border-t pt-4">{footer}</div> : null}
      </div>
    </main>
  );
}
