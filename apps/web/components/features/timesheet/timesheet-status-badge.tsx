import type { TimesheetStatus } from '@workpulse/shared-types';
import { type JSX } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Server-safe status pill for timesheet records. Maps each state to a
 * semantic Badge variant so the visual language stays consistent with
 * leave, overtime, and correction statuses across the app.
 *
 * INVARIANT: `data-testid` and `data-status` attributes are preserved
 * verbatim so the existing Playwright specs continue to work.
 *
 *  DRAFT              → muted
 *  PENDING_SUPERVISOR → warning (awaits action)
 *  PENDING_HR         → info    (progressed past supervisor)
 *  APPROVED           → success
 *  REJECTED           → destructive
 */
const LABELS: Record<TimesheetStatus, string> = {
  DRAFT: 'Draft',
  PENDING_SUPERVISOR: 'Menunggu supervisor',
  PENDING_HR: 'Menunggu HR',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
};

const VARIANTS: Record<
  TimesheetStatus,
  'muted' | 'warning' | 'info' | 'success' | 'destructive'
> = {
  DRAFT: 'muted',
  PENDING_SUPERVISOR: 'warning',
  PENDING_HR: 'info',
  APPROVED: 'success',
  REJECTED: 'destructive',
};

export function TimesheetStatusBadge({
  status,
  className,
}: {
  status: TimesheetStatus;
  className?: string;
}): JSX.Element {
  return (
    <Badge
      variant={VARIANTS[status]}
      className={cn(className)}
      data-testid="ts-status-badge"
      data-status={status}
    >
      {LABELS[status]}
    </Badge>
  );
}
