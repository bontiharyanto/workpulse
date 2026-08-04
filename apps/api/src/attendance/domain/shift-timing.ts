export interface ShiftBoundaries {
  /** "HH:mm" in the company/user timezone. */
  startTime: string;
  /** "HH:mm" in the company/user timezone. */
  endTime: string;
  /** Additional minutes past `startTime` that still count as ON_TIME. */
  graceMinutes: number;
  /** IANA timezone, e.g. "Asia/Jakarta". */
  timezone: string;
}

export interface AttendanceTiming {
  status: 'ON_TIME' | 'LATE';
  lateMinutes: number;
}

export interface ClockOutTiming {
  earlyLeaveMinutes: number;
}

/**
 * Compute lateness on clock-in. All calculations happen in the shift's timezone,
 * but comparisons are done on UTC epoch millis to avoid DST arithmetic edge cases.
 */
export function evaluateClockIn(
  clockInAt: Date,
  workDate: Date,
  shift: ShiftBoundaries,
): AttendanceTiming {
  const shiftStart = shiftBoundaryToUtc(workDate, shift.startTime, shift.timezone);
  const graceMs = shift.graceMinutes * 60_000;
  const diffMs = clockInAt.getTime() - (shiftStart.getTime() + graceMs);

  if (diffMs <= 0) {
    return { status: 'ON_TIME', lateMinutes: 0 };
  }
  return { status: 'LATE', lateMinutes: Math.ceil(diffMs / 60_000) };
}

export function evaluateClockOut(
  clockOutAt: Date,
  workDate: Date,
  shift: ShiftBoundaries,
): ClockOutTiming {
  const shiftEnd = shiftBoundaryToUtc(workDate, shift.endTime, shift.timezone);
  const diffMs = shiftEnd.getTime() - clockOutAt.getTime();
  if (diffMs <= 0) {
    return { earlyLeaveMinutes: 0 };
  }
  return { earlyLeaveMinutes: Math.ceil(diffMs / 60_000) };
}

/**
 * Build a UTC Date representing `workDate` (calendar day) at `hh:mm` in the given IANA tz.
 * Uses Intl to derive the tz offset without external dependencies.
 */
function shiftBoundaryToUtc(workDate: Date, hhmm: string, timezone: string): Date {
  const parts = hhmm.split(':');
  const hours = Number(parts[0]);
  const minutes = Number(parts[1] ?? '0');
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    throw new RangeError(`invalid HH:mm value: ${hhmm}`);
  }

  const y = workDate.getUTCFullYear();
  const m = workDate.getUTCMonth();
  const d = workDate.getUTCDate();

  const nominalUtc = new Date(Date.UTC(y, m, d, hours, minutes, 0, 0));
  const offsetMinutes = getTimezoneOffsetMinutes(nominalUtc, timezone);
  return new Date(nominalUtc.getTime() - offsetMinutes * 60_000);
}

function getTimezoneOffsetMinutes(instant: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(instant).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const asIfLocal = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asIfLocal - instant.getTime()) / 60_000;
}
