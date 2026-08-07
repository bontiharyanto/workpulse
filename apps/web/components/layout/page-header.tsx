import type { JSX, ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * Consistent page-level header used by every dashboard route. Left
 * column stacks title + description; right column reserved for the
 * primary action (e.g. "Ajukan cuti") plus any secondary controls.
 *
 * Placed OUTSIDE any Card — pages should look like Notion documents,
 * with the title floating on the page background, not trapped inside
 * a container. Actual data always sits in `Card`s below.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps): JSX.Element {
  return (
    <header
      className={cn(
        'flex flex-col gap-3 pb-6 md:flex-row md:items-start md:justify-between md:gap-6',
        className,
      )}
    >
      <div className="flex-1 space-y-1">
        <h1 className="text-foreground text-h1">{title}</h1>
        {description ? <p className="text-muted-foreground text-body">{description}</p> : null}
      </div>

      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
