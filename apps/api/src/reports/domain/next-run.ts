import type { ReportFrequency } from '@prisma/client';

/**
 * Fase 33c — pure "next-run" calculator.
 *
 * All dates in this module are UTC. Callers are responsible for
 * projecting `cadenceHour` from `Company.timezone` into a UTC instant
 * BEFORE the first call to `initialNextRun`.
 *
 * The scheduler cron ticks every 15 minutes (server side) so the
 * chosen minute-of-hour is always 0 — we deliberately do NOT expose
 * minute granularity in the schedule model.
 *
 * Correctness invariant: `advance(from, freq, day, hour) > from` for
 * ALL inputs. If the current cadenceHour has already elapsed for
 * today, we roll forward.
 */

const HOURS_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOURS_MS;

export interface CadenceConfig {
  frequency: ReportFrequency;
  /** DAILY: ignored. WEEKLY: 0..6 (Sunday=0). MONTHLY: 1..28. */
  cadenceDay: number | null;
  /** 0..23 in UTC. */
  cadenceHourUtc: number;
}

export class InvalidCadenceError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'InvalidCadenceError';
  }
}

/**
 * First `nextRunAt` when a schedule is created. Guarantees the
 * result is strictly in the future relative to `now`.
 */
export function initialNextRun(now: Date, cfg: CadenceConfig): Date {
  return advance(now, cfg);
}

export function advance(from: Date, cfg: CadenceConfig): Date {
  switch (cfg.frequency) {
    case 'DAILY':
      return advanceDaily(from, cfg.cadenceHourUtc);
    case 'WEEKLY':
      return advanceWeekly(from, cfg);
    case 'MONTHLY':
      return advanceMonthly(from, cfg);
  }
}

function advanceDaily(from: Date, hour: number): Date {
  validateHour(hour);
  const candidate = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hour, 0, 0, 0),
  );
  return candidate.getTime() > from.getTime() ? candidate : new Date(candidate.getTime() + DAY_MS);
}

function advanceWeekly(from: Date, cfg: CadenceConfig): Date {
  validateHour(cfg.cadenceHourUtc);
  if (
    cfg.cadenceDay == null ||
    !Number.isInteger(cfg.cadenceDay) ||
    cfg.cadenceDay < 0 ||
    cfg.cadenceDay > 6
  ) {
    throw new InvalidCadenceError(
      `WEEKLY schedule requires cadenceDay in [0..6], got ${cfg.cadenceDay}`,
    );
  }
  const base = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      cfg.cadenceHourUtc,
      0,
      0,
      0,
    ),
  );
  const currentDow = base.getUTCDay();
  let offset = (cfg.cadenceDay - currentDow + 7) % 7;
  if (offset === 0 && base.getTime() <= from.getTime()) {
    offset = 7;
  }
  return new Date(base.getTime() + offset * DAY_MS);
}

function advanceMonthly(from: Date, cfg: CadenceConfig): Date {
  validateHour(cfg.cadenceHourUtc);
  if (
    cfg.cadenceDay == null ||
    !Number.isInteger(cfg.cadenceDay) ||
    cfg.cadenceDay < 1 ||
    cfg.cadenceDay > 28
  ) {
    throw new InvalidCadenceError(
      `MONTHLY schedule requires cadenceDay in [1..28], got ${cfg.cadenceDay}`,
    );
  }
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();
  let candidate = new Date(Date.UTC(year, month, cfg.cadenceDay, cfg.cadenceHourUtc, 0, 0, 0));
  if (candidate.getTime() <= from.getTime()) {
    candidate = new Date(Date.UTC(year, month + 1, cfg.cadenceDay, cfg.cadenceHourUtc, 0, 0, 0));
  }
  return candidate;
}

function validateHour(hour: number): void {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new InvalidCadenceError(`cadenceHour must be integer in [0..23], got ${hour}`);
  }
}
