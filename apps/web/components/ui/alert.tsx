import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/**
 * Alert — inline banner for information / warning / errors. Use
 * `variant="destructive"` for hard-blocking errors, `warning` for
 * "you should know", `info` for hints, and `success` for confirmations.
 *
 * Consumers usually compose:
 *   <Alert variant="warning">
 *     <AlertTriangle className="h-4 w-4" />
 *     <AlertTitle>Payroll terkunci</AlertTitle>
 *     <AlertDescription>...</AlertDescription>
 *   </Alert>
 */
const alertVariants = cva(
  'relative w-full rounded-lg border p-4 [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg~*]:pl-7 [&>svg]:h-4 [&>svg]:w-4',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground border-border [&>svg]:text-muted-foreground',
        destructive:
          'border-destructive/50 text-destructive bg-destructive/5 dark:border-destructive [&>svg]:text-destructive',
        warning: 'border-warning/40 bg-warning/10 text-warning-foreground [&>svg]:text-warning',
        info: 'border-info/40 bg-info/5 text-info-foreground [&>svg]:text-info',
        success: 'border-success/40 bg-success/10 text-success-foreground [&>svg]:text-success',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

interface AlertProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

const Alert = forwardRef<HTMLDivElement, AlertProps>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = 'Alert';

const AlertTitle = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5
      ref={ref}
      className={cn('text-body mb-1 font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  ),
);
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('text-caption opacity-90 [&_p]:leading-relaxed', className)}
      {...props}
    />
  ),
);
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription, alertVariants };
