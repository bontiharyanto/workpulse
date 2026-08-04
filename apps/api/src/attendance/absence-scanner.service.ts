import { Injectable, Logger } from '@nestjs/common';
import { AbsenceSource } from '@prisma/client';

import { isPayrollLocked } from '../common/domain/payroll-lock';
import { attendanceAbsentMarked } from '../notification/domain/templates';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';

import type { CalendarDate } from '../leave/domain/calendar-date';

import {
  classifyAbsence,
  isWeekendDate,
  pendingScanDates,
  resolveTargetDate,
  type AbsenceSkipReason,
} from './domain/absence-scanner';

/** Maximum number of past days a single scanner run will backfill per tenant. */
export const MAX_BACKFILL_DAYS = 30;

export interface AbsenceScanResult {
  companyId: string;
  scannedDates: number;
  marked: number;
  skipped: Record<AbsenceSkipReason | 'ERROR', number>;
  durationMs: number;
}

export interface AbsenceScanRunResult {
  scannedCompanies: number;
  totalMarked: number;
  perCompany: AbsenceScanResult[];
  durationMs: number;
}

/**
 * Materialises "user was absent on a working day" as canonical
 * `AbsenceRecord` rows.
 *
 * ## Idempotency
 *
 * Every write is guarded by the unique `(userId, workDate)` index on
 * `AbsenceRecord`. Concurrent scanner instances (single Nest process
 * with multiple pods, or manual admin trigger + cron overlap) cannot
 * create duplicates. Race-losers surface as `P2002` and are counted
 * as `ALREADY_MARKED` skips.
 *
 * ## Per-tenant cursor
 *
 * `Company.lastAbsentScanDate` records the most recent date processed.
 * `pendingScanDates()` uses this cursor to compute the exact range of
 * dates to backfill, capped at `MAX_BACKFILL_DAYS`. This makes the
 * scheduler robust to outages ("we were down for 3 days → catch up
 * automatically") and cheap during steady state ("nothing to do →
 * pendingScanDates returns []").
 *
 * ## Not transactional across users
 *
 * Each `AbsenceRecord` insert + its notification is its own tiny
 * transaction. A failure at user N doesn't roll back users 0..N-1.
 * The scheduler tracks per-reason skip counts for observability.
 *
 * ## Notification fanout
 *
 * A marked absence emits `ATTENDANCE_ABSENT_MARKED` to the employee
 * AND to their supervisor (if any). Notification failure is logged
 * but never rolls back the classification — the classification is the
 * source of truth, notifications are a delivery mechanism.
 */
@Injectable()
export class AbsenceScannerService {
  private readonly logger = new Logger(AbsenceScannerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Reset a single tenant's `lastAbsentScanDate` cursor to `null` and
   * optionally trigger a fresh single-tenant scan. Used by SUPER_ADMIN
   * ops when the cursor is out of sync — e.g. HR added a holiday
   * retroactively, or shift assignments were backdated for a period
   * the cursor has already passed.
   *
   * ## Why this is destructive
   *
   * Clearing the cursor makes the next run backfill up to
   * `MAX_BACKFILL_DAYS` days of historical dates. Absent records are
   * idempotent on `(userId, workDate)` so we won't create duplicates,
   * BUT the notification fanout is NOT deduped — running this on a
   * tenant that already has recent absences will re-notify affected
   * users. We accept this on purpose: the whole point of a manual
   * reset is that HR wants to re-classify, and the notification is
   * an acceptable side effect of a rare admin operation.
   *
   * ## Payroll-locked dates
   *
   * Locked dates are still skipped (with `PAYROLL_LOCKED` reason)
   * during the ensuing scan — reset does NOT bypass ADR-0010's
   * write barrier. Same rule regardless of who triggered the scan.
   *
   * @param companyId Tenant to reset. Caller enforces this matches
   *   the actor's tenant (or SUPER_ADMIN cross-tenant is out of scope
   *   for MVP — the controller enforces `actor.companyId`).
   * @param options.triggerRescan When true, immediately run
   *   `scanCompanyById` for the same tenant after the reset. The
   *   scan result is returned so the caller can surface counts.
   */
  async resetCursor(
    companyId: string,
    options: {
      triggerRescan?: boolean;
      now?: Date;
      /**
       * Actor identity for audit trail. When omitted (unit tests) the
       * audit log entry is skipped — production callers should always
       * pass the actor.
       */
      actor?: { id: string };
    } = {},
  ): Promise<{
    before: Date | null;
    after: null;
    rescanTriggered: boolean;
    rescanResult?: AbsenceScanResult;
  }> {
    const existing = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { id: true, lastAbsentScanDate: true },
    });
    if (!existing) {
      // The controller has already verified the actor's tenant at RBAC
      // time — a mismatch here is a genuine "tenant vanished mid-flight",
      // extremely rare. Bubble as-is; the controller translates.
      throw new Error(`COMPANY_NOT_FOUND: ${companyId}`);
    }

    const before = existing.lastAbsentScanDate ?? null;

    // Reset + audit inside a transaction — either both happen or neither.
    // Cursor drift + missing audit entry is exactly the disaster this
    // endpoint is supposed to make TRACEABLE, so the audit row is
    // non-optional in the write path.
    await this.prisma.$transaction(async (tx) => {
      await tx.company.update({
        where: { id: companyId },
        data: { lastAbsentScanDate: null },
      });
      if (options.actor) {
        await tx.auditLog.create({
          data: {
            companyId,
            actorId: options.actor.id,
            action: 'SCANNER_CURSOR_RESET',
            entityType: 'Company',
            entityId: companyId,
            beforeJson: {
              lastAbsentScanDate: before ? before.toISOString() : null,
            },
            afterJson: {
              lastAbsentScanDate: null,
              triggerRescan: options.triggerRescan ?? false,
            },
          },
        });
      }
    });

    if (!options.triggerRescan) {
      return { before, after: null, rescanTriggered: false };
    }

    const rescanResult = await this.scanCompanyById(companyId, options.now);
    return {
      before,
      after: null,
      rescanTriggered: true,
      rescanResult,
    };
  }

  /**
   * Same iteration used inside `runAll` for a specific tenant. Split
   * out so the reset endpoint can trigger a targeted rescan without
   * paying for every-tenant iteration.
   */
  async scanCompanyById(companyId: string, now: Date = new Date()): Promise<AbsenceScanResult> {
    const co = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: {
        id: true,
        timezone: true,
        absentScanGraceHours: true,
        lastAbsentScanDate: true,
        payrollLockedUntil: true,
      },
    });
    if (!co) {
      throw new Error(`COMPANY_NOT_FOUND: ${companyId}`);
    }
    const targetDate = resolveTargetDate(now, co.timezone, co.absentScanGraceHours);
    if (targetDate === null) {
      return this.emptyScanResult(companyId);
    }
    const lastScanned = co.lastAbsentScanDate ? toIsoDate(co.lastAbsentScanDate) : null;
    const dates = pendingScanDates(targetDate, lastScanned, MAX_BACKFILL_DAYS);
    if (dates.length === 0) {
      return this.emptyScanResult(companyId);
    }
    return this.scanCompany(co.id, dates, co.payrollLockedUntil);
  }

  private emptyScanResult(companyId: string): AbsenceScanResult {
    return {
      companyId,
      scannedDates: 0,
      marked: 0,
      skipped: {
        INACTIVE: 0,
        NOT_HIRED_YET: 0,
        WEEKEND: 0,
        HOLIDAY: 0,
        NO_SHIFT_ASSIGNMENT: 0,
        CLOCKED_IN: 0,
        ON_APPROVED_LEAVE: 0,
        ALREADY_MARKED: 0,
        PAYROLL_LOCKED: 0,
        ERROR: 0,
      },
      durationMs: 0,
    };
  }

  /**
   * Run the scanner across every ACTIVE tenant. Called by the cron
   * scheduler and also exposed via a manual trigger endpoint.
   */
  async runAll(options: { now?: Date } = {}): Promise<AbsenceScanRunResult> {
    const startedAt = Date.now();
    const now = options.now ?? new Date();

    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        timezone: true,
        absentScanGraceHours: true,
        lastAbsentScanDate: true,
        payrollLockedUntil: true,
      },
    });

    const perCompany: AbsenceScanResult[] = [];
    let totalMarked = 0;

    for (const co of companies) {
      const targetDate = resolveTargetDate(now, co.timezone, co.absentScanGraceHours);
      if (targetDate === null) continue;

      const lastScanned = co.lastAbsentScanDate ? toIsoDate(co.lastAbsentScanDate) : null;
      const dates = pendingScanDates(targetDate, lastScanned, MAX_BACKFILL_DAYS);
      if (dates.length === 0) continue;

      const result = await this.scanCompany(co.id, dates, co.payrollLockedUntil);
      perCompany.push(result);
      totalMarked += result.marked;
    }

    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `absence scanner run: companies=${perCompany.length} marked=${totalMarked} durationMs=${durationMs}`,
    );
    return {
      scannedCompanies: perCompany.length,
      totalMarked,
      perCompany,
      durationMs,
    };
  }

  /**
   * Process one company across (possibly multiple) dates. Advances
   * `lastAbsentScanDate` cursor to the *last* date successfully
   * processed, so a subsequent run picks up where this one left off.
   *
   * Exposed as public so admin endpoints can trigger a targeted rescan
   * (e.g. "our HR just added last Wednesday's holiday retroactively —
   * please re-classify").
   */
  async scanCompany(
    companyId: string,
    dates: CalendarDate[],
    payrollLockedUntil: Date | null = null,
  ): Promise<AbsenceScanResult> {
    const startedAt = Date.now();
    const skipped: AbsenceScanResult['skipped'] = {
      INACTIVE: 0,
      NOT_HIRED_YET: 0,
      WEEKEND: 0,
      HOLIDAY: 0,
      NO_SHIFT_ASSIGNMENT: 0,
      CLOCKED_IN: 0,
      ON_APPROVED_LEAVE: 0,
      ALREADY_MARKED: 0,
      PAYROLL_LOCKED: 0,
      ERROR: 0,
    };
    let marked = 0;
    let lastProcessed: CalendarDate | null = null;

    for (const workDate of dates) {
      // Payroll cutoff short-circuit — never touch a frozen date.
      // Cursor advances past this date so we don't keep re-checking every
      // hour: once locked, the scanner will never re-classify. If HR
      // moves the cutoff backward (rare, SUPER_ADMIN operation) they
      // must trigger a manual rescan; see ADR-0010.
      if (isPayrollLocked(toDateOnly(workDate), payrollLockedUntil)) {
        skipped.PAYROLL_LOCKED += 1;
        lastProcessed = workDate;
        continue;
      }

      try {
        const dayResult = await this.scanCompanyForDate(companyId, workDate);
        marked += dayResult.marked;
        for (const [reason, count] of Object.entries(dayResult.skipped)) {
          const key = reason as keyof typeof skipped;
          skipped[key] += count;
        }
        lastProcessed = workDate;
      } catch (err) {
        skipped.ERROR += 1;
        this.logger.error(
          `absence scanner: company=${companyId} date=${workDate} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        // Stop advancing the cursor at this date so it's retried next tick.
        break;
      }
    }

    if (lastProcessed) {
      await this.prisma.company
        .update({
          where: { id: companyId },
          data: { lastAbsentScanDate: toDateOnly(lastProcessed) },
        })
        .catch((err) => {
          this.logger.error(
            `absence scanner: failed to update lastAbsentScanDate for company=${companyId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
    }

    return {
      companyId,
      scannedDates: dates.length,
      marked,
      skipped,
      durationMs: Date.now() - startedAt,
    };
  }

  // ------------------------------------------------------------------
  // Internal — single (company, date) pass
  // ------------------------------------------------------------------

  private async scanCompanyForDate(
    companyId: string,
    workDate: CalendarDate,
  ): Promise<{ marked: number; skipped: Record<string, number> }> {
    const skipped: Record<string, number> = {};
    let marked = 0;

    // Trivial short-circuit: weekend for the whole tenant. Avoids
    // pulling the roster on Sat/Sun (a common no-op case).
    if (isWeekendDate(workDate)) {
      // We still need to count roster size for observability? No — the
      // classifier would count them all as WEEKEND. Skip the DB roundtrip
      // and return an empty result to keep the scanner cheap on weekends.
      return { marked: 0, skipped: {} };
    }

    // One-shot loads for the whole company × date.
    const [roster, holidayRow, attendance, absences, approvedLeaves] = await Promise.all([
      this.loadRoster(companyId, workDate),
      this.prisma.holiday.findFirst({
        where: { companyId, date: toDateOnly(workDate) },
        select: { id: true },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { companyId, workDate: toDateOnly(workDate), deletedAt: null },
        select: { userId: true },
      }),
      this.prisma.absenceRecord.findMany({
        where: { companyId, workDate: toDateOnly(workDate) },
        select: { userId: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          companyId,
          status: 'APPROVED',
          startDate: { lte: toDateOnly(workDate) },
          endDate: { gte: toDateOnly(workDate) },
          deletedAt: null,
        },
        select: { userId: true },
      }),
    ]);

    const isHoliday = Boolean(holidayRow);
    const attendedIds = new Set(attendance.map((r) => r.userId));
    const alreadyMarkedIds = new Set(absences.map((r) => r.userId));
    const onLeaveIds = new Set(approvedLeaves.map((r) => r.userId));

    for (const member of roster) {
      const decision = classifyAbsence({
        targetDate: workDate,
        employmentStatus: member.employmentStatus,
        hiredAt: toIsoDate(member.hiredAt),
        hasShiftAssignment: member.hasShiftAssignment,
        isHoliday,
        isWeekend: false, // already short-circuited above
        hasAttendance: attendedIds.has(member.userId),
        hasApprovedLeave: onLeaveIds.has(member.userId),
        hasExistingAbsence: alreadyMarkedIds.has(member.userId),
      });

      if (decision.kind === 'SKIP') {
        skipped[decision.reason] = (skipped[decision.reason] ?? 0) + 1;
        continue;
      }

      const inserted = await this.insertAbsence({
        companyId,
        userId: member.userId,
        workDate,
        supervisorId: member.supervisorId,
        supervisorEmail: member.supervisorEmail,
        recipientEmail: member.email,
        employeeName: member.fullName,
      });
      if (inserted) {
        marked += 1;
      } else {
        skipped.ALREADY_MARKED = (skipped.ALREADY_MARKED ?? 0) + 1;
      }
    }

    return { marked, skipped };
  }

  /**
   * Load every ACTIVE + ON_LEAVE user of the company along with:
   *   * their supervisor's id/email (for the "your report was marked absent" bell)
   *   * whether they have a shift assignment covering `workDate`
   *
   * TERMINATED / SUSPENDED users are pre-filtered so the classifier's
   * `INACTIVE` branch never has to look at them — keeping observability
   * cleaner (no spurious skip-count inflation from ex-employees).
   */
  private async loadRoster(companyId: string, workDate: CalendarDate) {
    const workDateAsDate = toDateOnly(workDate);

    const users = await this.prisma.user.findMany({
      where: {
        companyId,
        deletedAt: null,
        employmentStatus: { in: ['ACTIVE', 'ON_LEAVE'] },
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        hiredAt: true,
        employmentStatus: true,
        supervisorId: true,
        supervisor: { select: { id: true, email: true } },
        shiftAssignments: {
          where: {
            deletedAt: null,
            effectiveFrom: { lte: workDateAsDate },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: workDateAsDate } }],
          },
          select: { id: true },
          take: 1,
        },
      },
    });

    return users.map((u) => ({
      userId: u.id,
      email: u.email,
      fullName: u.fullName,
      hiredAt: u.hiredAt,
      employmentStatus: u.employmentStatus,
      supervisorId: u.supervisor?.id ?? null,
      supervisorEmail: u.supervisor?.email ?? null,
      hasShiftAssignment: u.shiftAssignments.length > 0,
    }));
  }

  private async insertAbsence(args: {
    companyId: string;
    userId: string;
    workDate: CalendarDate;
    supervisorId: string | null;
    supervisorEmail: string | null;
    recipientEmail: string;
    employeeName: string;
  }): Promise<boolean> {
    try {
      await this.prisma.absenceRecord.create({
        data: {
          companyId: args.companyId,
          userId: args.userId,
          workDate: toDateOnly(args.workDate),
          source: AbsenceSource.AUTO_SCHEDULER,
        },
      });
    } catch (err) {
      // P2002: unique(userId, workDate) collision — someone else already
      // marked. Idempotent success, not an error.
      if (isUniqueViolation(err)) return false;
      throw err;
    }

    // Notifications — best-effort. Failures logged but not fatal.
    const employeeContent = attendanceAbsentMarked({
      workDate: args.workDate,
      employeeName: args.employeeName,
      forSupervisor: false,
    });
    await this.notifications
      .createOne({
        companyId: args.companyId,
        recipientId: args.userId,
        recipientEmail: args.recipientEmail,
        content: employeeContent,
      })
      .catch((e) =>
        this.logger.warn(
          `absent notify employee failed userId=${args.userId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      );

    if (args.supervisorId) {
      const supContent = attendanceAbsentMarked({
        workDate: args.workDate,
        employeeName: args.employeeName,
        forSupervisor: true,
      });
      await this.notifications
        .createOne({
          companyId: args.companyId,
          recipientId: args.supervisorId,
          recipientEmail: args.supervisorEmail ?? undefined,
          content: supContent,
        })
        .catch((e) =>
          this.logger.warn(
            `absent notify supervisor failed userId=${args.supervisorId}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
        );
    }

    return true;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function toIsoDate(d: Date): CalendarDate {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}` as CalendarDate;
}

function toDateOnly(iso: CalendarDate): Date {
  // Postgres @db.Date stores midnight UTC; Prisma normalises string
  // inputs but we prefer an explicit Date so tests can spy on exact
  // arguments regardless of driver behaviour.
  const [ys, ms, ds] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(ys, ms - 1, ds));
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  );
}
