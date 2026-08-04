import { BarChart3 } from 'lucide-react';
import { type JSX, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface EmptyChartProps {
  title?: string;
  description?: string;
  action?: ReactNode;
  height?: number;
  className?: string;
}

/**
 * Consistent empty state for every chart primitive. Rendered when
 * the caller has no data yet (fresh install, filter yields zero
 * rows, or a fetch that succeeded with an empty array).
 *
 * NOT for error states — those use `<Alert variant="destructive">`.
 * NOT for loading — those use `<Skeleton />`.
 */
export function EmptyChart({
  title = 'Belum ada data',
  description = 'Data akan muncul di sini setelah aktivitas pertama tercatat.',
  action,
  height = 200,
  className,
}: EmptyChartProps): JSX.Element {
  return (
    <div
      role="status"
      className={cn(
        'border-border bg-muted/20 flex flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center',
        className,
      )}
      style={{ minHeight: height }}
    >
      <BarChart3 className="text-muted-foreground/50 mb-2 h-8 w-8" aria-hidden />
      <p className="text-h6 text-foreground">{title}</p>
      <p className="text-muted-foreground text-caption mt-1 max-w-sm">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
