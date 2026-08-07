import type { LeaveStatus } from '@workpulse/shared-types';
import { type JSX } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Server-safe status pill for leave requests. Maps each state to a
 * semantic Badge variant so the visual language stays consistent
 * with corrections, overtime, and other status pills across the app.
 *
 * `PENDING_SUPERVISOR` → warning (needs action, still reversible).
 * `PENDING_HR` → info (progressed past supervisor, still open).
 * `APPROVED` → success. `REJECTED` → destructive.
 * `DRAFT` / `CANCELLED` → muted (inactive).
 */
const LABELS: Record<LeaveStatus, string> = {
  DRAFT: 'Draft',
  PENDING_SUPERVISOR: 'Menunggu Supervisor',
  PENDING_HR: 'Menunggu HR',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  CANCELLED: 'Dibatalkan',
};

const VARIANTS: Record<LeaveStatus, 'muted' | 'warning' | 'info' | 'success' | 'destructive'> = {
  DRAFT: 'muted',
  PENDING_SUPERVISOR: 'warning',
  PENDING_HR: 'info',
  APPROVED: 'success',
  REJECTED: 'destructive',
  CANCELLED: 'muted',
};

export function LeaveStatusBadge({
  status,
  className,
}: {
  status: LeaveStatus;
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
