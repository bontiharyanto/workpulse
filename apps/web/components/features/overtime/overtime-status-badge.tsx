import type { OvertimeStatus } from '@workpulse/shared-types';
import { type JSX } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Status pill for overtime requests, mapped to semantic Badge
 * variants so the visual language stays consistent with leave and
 * correction statuses.
 *
 *  PENDING_APPROVAL → warning
 *  APPROVED         → success
 *  COMPLETED        → info (payable, finalized)
 *  REJECTED         → destructive
 *  CANCELLED        → muted
 */
const LABELS: Record<OvertimeStatus, string> = {
  PENDING_APPROVAL: 'Menunggu Approval',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  COMPLETED: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

const VARIANTS: Record<
  OvertimeStatus,
  'muted' | 'warning' | 'success' | 'info' | 'destructive'
> = {
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  COMPLETED: 'info',
  REJECTED: 'destructive',
  CANCELLED: 'muted',
};

export function OvertimeStatusBadge({
  status,
  className,
}: {
  status: OvertimeStatus;
  className?: string;
}): JSX.Element {
  return (
    <Badge
      variant={VARIANTS[status]}
      className={cn(status === 'CANCELLED' && 'line-through', className)}
    >
      {LABELS[status]}
    </Badge>
  );
}
