import type { AttendanceStatus, TeamAttendanceStatus } from '@workpulse/shared-types';
import { CheckCircle2, Clock, LogOut, MinusCircle, Umbrella, XCircle } from 'lucide-react';
import { type JSX } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Centralized attendance status pill. Previously duplicated in three
 * files (`clock-panel`, `attendance-history`, `team-attendance`) with
 * slightly different color choices — collapsed here so the whole
 * module speaks one visual language.
 *
 * `LATE` and `EARLY_LEAVE` map to `warning` (not `destructive`)
 * because they're not blocking states — they're policy soft-flags.
 * `ABSENT` is `destructive`, `ON_TIME` is `success`, `ON_LEAVE` is
 * `info`, `NOT_CLOCKED_IN` is `muted`.
 */
type ExtendedStatus = AttendanceStatus | TeamAttendanceStatus;

interface StatusConfig {
  label: string;
  variant: 'success' | 'warning' | 'destructive' | 'info' | 'muted';
  Icon: typeof CheckCircle2;
}

const CONFIG: Record<ExtendedStatus, StatusConfig> = {
  ON_TIME: { label: 'Tepat waktu', variant: 'success', Icon: CheckCircle2 },
  LATE: { label: 'Terlambat', variant: 'warning', Icon: Clock },
  EARLY_LEAVE: { label: 'Pulang cepat', variant: 'warning', Icon: LogOut },
  ABSENT: { label: 'Absen', variant: 'destructive', Icon: XCircle },
  ON_LEAVE: { label: 'Cuti / izin', variant: 'info', Icon: Umbrella },
  NOT_CLOCKED_IN: { label: 'Belum absen', variant: 'muted', Icon: MinusCircle },
};

interface StatusBadgeProps {
  status: ExtendedStatus;
  /** Optional override for the visible label, e.g. `"Terlambat 15m"`. */
  labelOverride?: string;
  /** Hide the icon when the row is narrow (tables with 8+ columns). */
  iconOnly?: boolean;
  className?: string;
}

export function StatusBadge({
  status,
  labelOverride,
  iconOnly = false,
  className,
}: StatusBadgeProps): JSX.Element {
  const { label, variant, Icon } = CONFIG[status];
  return (
    <Badge variant={variant} className={cn('gap-1 whitespace-nowrap font-medium', className)}>
      <Icon className="h-3 w-3" aria-hidden />
      {!iconOnly && <span>{labelOverride ?? label}</span>}
    </Badge>
  );
}

/** Public helper for callers that want the raw label without a Badge. */
export function attendanceStatusLabel(status: ExtendedStatus): string {
  return CONFIG[status].label;
}
