'use client';

import * as ProgressPrimitive from '@radix-ui/react-progress';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * Progress bar. Semantic tone (`default`, `success`, `warning`,
 * `destructive`) drives the indicator color, so callers can express
 * threshold intent — e.g. leave balance running low is `warning`,
 * exhausted is `destructive`.
 */
type ProgressTone = 'default' | 'success' | 'warning' | 'destructive';

interface ProgressProps extends ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  tone?: ProgressTone;
}

const TONE_CLASS: Record<ProgressTone, string> = {
  default: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
};

const Progress = forwardRef<ElementRef<typeof ProgressPrimitive.Root>, ProgressProps>(
  ({ className, value, tone = 'default', ...props }, ref) => (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn('bg-muted relative h-2 w-full overflow-hidden rounded-full', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn('h-full w-full flex-1 transition-transform', TONE_CLASS[tone])}
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  ),
);
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
