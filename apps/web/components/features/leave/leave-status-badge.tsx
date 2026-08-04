import type { LeaveStatus } from '@workpulse/shared-types';

const LABELS: Record<LeaveStatus, string> = {
  DRAFT: 'Draft',
  PENDING_SUPERVISOR: 'Menunggu Supervisor',
  PENDING_HR: 'Menunggu HR',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  CANCELLED: 'Dibatalkan',
};

const CLASSES: Record<LeaveStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  PENDING_SUPERVISOR: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  PENDING_HR: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  APPROVED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  REJECTED: 'bg-destructive/10 text-destructive',
  CANCELLED: 'bg-muted text-muted-foreground line-through',
};

export function LeaveStatusBadge({ status }: { status: LeaveStatus }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CLASSES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
