import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  LeaveStatus,
  OvertimeStatus,
  Prisma,
  TimesheetEntryKind,
  TimesheetStatus,
  WeekStartDay,
} from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { timesheetRegenerated } from '../notification/domain/templates';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  BuildEntryInput,
  BuiltEntry,
  buildEntry,
  rollupTimesheet,
  type AttendanceInput,
  type OvertimeInput,
  type LeaveDayInput,
  type AbsenceInput,
  type HolidayInput,
  type ShiftAssignmentInput,
} from './domain/entry-builder';
import { calculatePeriod } from './domain/period-calculator';
import { isRegenerateLocked } from './domain/submission-workflow';
import { TimesheetConfigService } from './timesheet-config.service';

/**
 * Prisma-transaction-shape we accept for read-only helpers. Callers
 * from another service may pass their own `tx`; internal callers
 * default to the service's own `prisma`.
 */
type PrismaLike =
  PrismaService | Prisma.TransactionClient | Omit<PrismaService, '$connect' | '$disconnect'>;

/**
 * Public shape of a timesheet returned by the read endpoints. Kept
 * decoupled from the raw Prisma model so we can enrich it (user name,
 * period label, etc) without leaking DB columns.
 */
export interface TimesheetView {
  id: string;
  periodId: string;
  periodStart: string; // "YYYY-MM-DD"
  periodEnd: string;
  periodLabel: string;
  user: {
    id: string;
    fullName: string;
    email: string;
    departmentName: string | null;
  };
  totals: {
    regularHours: number;
    overtimeHours: number;
    leaveDays: number;
    absentDays: number;
    holidays: number;
    workingDays: number;
    lateMinutes: number;
    earlyLeaveMinutes: number;
  };
  entries: Array<{
    workDate: string;
    kind: TimesheetEntryKind;
    expectedHours: number | null;
    regularHours: number;
    overtimeHours: number;
    leaveHours: number;
    lateMinutes: number;
    earlyLeaveMinutes: number;
    note: string | null;
  }>;
  generatedAt: string;
  /** Fase 32b — review lifecycle. */
  status: TimesheetStatus;
  submittedAt: string | null;
  supervisorNote: string | null;
  hrManagerNote: string | null;
  rejectionReason: string | null;
  /** Fase 32g — reopen provenance surfaced on both summary + view. */
  reopenCount: number;
  lastReopenedAt: string | null;
  lastReopenReason: string | null;
}

export interface TimesheetSummary {
  id: string;
  periodId: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  user: {
    id: string;
    fullName: string;
    email: string;
    departmentName: string | null;
  };
  totals: TimesheetView['totals'];
  generatedAt: string;
  status: TimesheetStatus;
  submittedAt: string | null;
  rejectionReason: string | null;
  reopenCount: number;
  lastReopenedAt: string | null;
  lastReopenReason: string | null;
}

/**
 * Materialises `Timesheet` + `TimesheetEntry` snapshots for a company
 * from the primary sources (Attendance, Overtime, Leave, Absence,
 * Holiday, ShiftAssignment). Idempotent — a second run on the same
 * period overwrites the existing rows so corrections propagate.
 */
@Injectable()
export class TimesheetService {
  private readonly logger = new Logger(TimesheetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: TimesheetConfigService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Generate (or regenerate) timesheets for every eligible user in a
   * company for the period containing `at`. Called by:
   *   - HR "Regenerate" button.
   *   - Test-support endpoint.
   *   - (Fase 32b) auto-generation scheduler when a period closes.
   */
  async generateForPeriod(
    companyId: string,
    at: Date,
  ): Promise<{
    periodId: string;
    timesheetsGenerated: number;
    timesheetsSkippedApproved: number;
  }> {
    const config = await this.configService.getForCompany(companyId);
    const period = calculatePeriod(at, {
      periodType: config.periodType,
      weekStartDay: config.weekStartDay,
      biweeklyAnchor: config.biweeklyAnchor,
      cutoffDayOfMonth: config.cutoffDayOfMonth,
      timezone: config.timezone,
    });

    const users = await this.prisma.user.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, companyId: true },
    });

    const [holidays] = await Promise.all([
      this.prisma.holiday.findMany({
        where: {
          companyId,
          date: { gte: period.periodStart, lte: period.periodEnd },
        },
      }),
    ]);
    const holidayByDate = new Map(
      holidays.map((h) => [
        toYmd(h.date, config.timezone),
        {
          workDate: toYmd(h.date, config.timezone),
          name: h.name,
          holidayId: h.id,
        } as HolidayInput,
      ]),
    );

    const periodRow = await this.prisma.timesheetPeriod.upsert({
      where: {
        companyId_periodStart_periodEnd: {
          companyId,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
        },
      },
      create: {
        companyId,
        periodType: config.periodType,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        label: period.label,
        generatedAt: new Date(),
      },
      update: {
        label: period.label,
        generatedAt: new Date(),
      },
    });

    // Load which users already have an APPROVED timesheet in this
    // period — those are locked (Fase 32b) and MUST NOT be
    // regenerated: doing so would silently drop the HR seal and any
    // downstream payroll snapshot referencing it.
    const lockedUsers = await this.prisma.timesheet.findMany({
      where: {
        companyId,
        periodId: periodRow.id,
        status: TimesheetStatus.APPROVED,
      },
      select: { userId: true },
    });
    const lockedSet = new Set(lockedUsers.map((r) => r.userId));

    let regenerated = 0;
    let skipped = 0;
    for (const user of users) {
      if (lockedSet.has(user.id)) {
        skipped += 1;
        continue;
      }
      await this.generateOneUser({
        companyId,
        userId: user.id,
        periodId: periodRow.id,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        timezone: config.timezone,
        weekStartDay: config.weekStartDay,
        holidayByDate,
      });
      regenerated += 1;
    }

    return {
      periodId: periodRow.id,
      timesheetsGenerated: regenerated,
      timesheetsSkippedApproved: skipped,
    };
  }

  /**
   * Fase 32b — Correction hook. Called by AttendanceCorrectionService
   * AFTER an approved correction commits the source-row change. Regenerates
   * the affected user's timesheet for the period containing `workDate`,
   * bumps the row back to DRAFT if it was mid-workflow, and emits a
   * `TIMESHEET_REGENERATED` notification so the user knows to re-review.
   *
   * If the timesheet is already `APPROVED`, we throw 409 — the caller
   * should have refused the correction before we get here. This is
   * defence-in-depth against a race where two correction approvals
   * interleave with an HR final-approve.
   */
  async regenerateForCorrection(
    companyId: string,
    userId: string,
    workDate: Date,
  ): Promise<{ regenerated: boolean; wasPending: boolean }> {
    const config = await this.configService.getForCompany(companyId);
    const period = calculatePeriod(workDate, {
      periodType: config.periodType,
      weekStartDay: config.weekStartDay,
      biweeklyAnchor: config.biweeklyAnchor,
      cutoffDayOfMonth: config.cutoffDayOfMonth,
      timezone: config.timezone,
    });

    const periodRow = await this.prisma.timesheetPeriod.upsert({
      where: {
        companyId_periodStart_periodEnd: {
          companyId,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
        },
      },
      create: {
        companyId,
        periodType: config.periodType,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        label: period.label,
      },
      update: { label: period.label },
    });

    const existing = await this.prisma.timesheet.findUnique({
      where: { userId_periodId: { userId, periodId: periodRow.id } },
      select: { id: true, status: true },
    });
    if (existing && isRegenerateLocked(existing.status)) {
      throw new ConflictException({
        statusCode: 409,
        code: 'TIMESHEET_APPROVED_LOCK',
        message:
          'Timesheet untuk periode tersebut sudah APPROVED oleh HR — koreksi tidak lagi diperbolehkan.',
      });
    }

    const holidays = await this.prisma.holiday.findMany({
      where: {
        companyId,
        date: { gte: period.periodStart, lte: period.periodEnd },
      },
    });
    const holidayByDate = new Map(
      holidays.map((h) => [
        toYmd(h.date, config.timezone),
        {
          workDate: toYmd(h.date, config.timezone),
          name: h.name,
          holidayId: h.id,
        } as HolidayInput,
      ]),
    );

    await this.generateOneUser({
      companyId,
      userId,
      periodId: periodRow.id,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      timezone: config.timezone,
      weekStartDay: config.weekStartDay,
      holidayByDate,
    });

    // Reset workflow if the correction landed on a mid-workflow row.
    // Rejected / draft stays as-is — the user has to submit anyway.
    const wasPending =
      existing !== null &&
      (existing.status === TimesheetStatus.PENDING_SUPERVISOR ||
        existing.status === TimesheetStatus.PENDING_HR);
    if (wasPending) {
      await this.prisma.timesheet.update({
        where: { userId_periodId: { userId, periodId: periodRow.id } },
        data: {
          status: TimesheetStatus.DRAFT,
          submittedAt: null,
          supervisorAt: null,
          supervisorNote: null,
          supervisor: { disconnect: true },
          hrManagerAt: null,
          hrManagerNote: null,
          hrManager: { disconnect: true },
          rejectedAt: null,
          rejectionReason: null,
          rejectedBy: { disconnect: true },
        },
      });
    }

    // Notify the user their timesheet was re-materialised.
    const refreshed = await this.prisma.timesheet.findUnique({
      where: { userId_periodId: { userId, periodId: periodRow.id } },
      include: {
        period: true,
        user: { select: { id: true, email: true, fullName: true } },
      },
    });
    if (refreshed) {
      await this.notifications.createOne({
        companyId,
        recipientId: refreshed.userId,
        recipientEmail: refreshed.user.email,
        content: timesheetRegenerated({
          timesheetId: refreshed.id,
          requesterName: refreshed.user.fullName ?? refreshed.user.email,
          periodLabel: refreshed.period.label,
          periodStart: toYmdUtc(refreshed.period.periodStart),
          periodEnd: toYmdUtc(refreshed.period.periodEnd),
        }),
      });
    }

    return { regenerated: true, wasPending };
  }

  /**
   * Fase 32b — cheap pre-check for AttendanceCorrectionService. Called
   * INSIDE the correction's transaction so an APPROVED timesheet
   * blocks the correction approval before any state changes.
   */
  async assertCorrectionAllowed(
    tx: PrismaLike,
    companyId: string,
    userId: string,
    workDate: Date,
  ): Promise<void> {
    const client = tx as Prisma.TransactionClient;
    const locked = await client.timesheet.findFirst({
      where: {
        companyId,
        userId,
        status: TimesheetStatus.APPROVED,
        period: {
          periodStart: { lte: workDate },
          periodEnd: { gte: workDate },
        },
      },
      select: { id: true },
    });
    if (locked) {
      throw new ConflictException({
        statusCode: 409,
        code: 'TIMESHEET_APPROVED_LOCK',
        message:
          'Tanggal kerja tersebut berada di dalam timesheet yang sudah APPROVED. Buka kunci di sisi timesheet dulu (HR) sebelum mengajukan koreksi.',
      });
    }
  }

  private async generateOneUser(args: {
    companyId: string;
    userId: string;
    periodId: string;
    periodStart: Date;
    periodEnd: Date;
    timezone: string;
    weekStartDay: WeekStartDay;
    holidayByDate: Map<string, HolidayInput>;
  }): Promise<void> {
    const { companyId, userId, periodId, periodStart, periodEnd, timezone, holidayByDate } = args;

    // Load everything we need in one shot per user. This ends up as
    // ~5 queries per user × N users; if `N` grows past ~500 in one
    // tenant we'd batch. For 32a we prioritise correctness over that
    // last mile.
    const [attendance, overtimes, leaves, absences, shiftAssignments] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: {
          userId,
          workDate: { gte: periodStart, lte: periodEnd },
          deletedAt: null,
        },
      }),
      this.prisma.overtimeRequest.findMany({
        where: {
          userId,
          workDate: { gte: periodStart, lte: periodEnd },
          status: { in: [OvertimeStatus.APPROVED, OvertimeStatus.COMPLETED] },
        },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          userId,
          status: LeaveStatus.APPROVED,
          // A leave overlaps the period if [startDate, endDate]
          // intersects [periodStart, periodEnd].
          startDate: { lte: periodEnd },
          endDate: { gte: periodStart },
          deletedAt: null,
        },
        include: { leaveType: true },
      }),
      this.prisma.absenceRecord.findMany({
        where: {
          userId,
          workDate: { gte: periodStart, lte: periodEnd },
        },
      }),
      this.prisma.userShiftAssignment.findMany({
        where: {
          userId,
          effectiveFrom: { lte: periodEnd },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodStart } }],
          deletedAt: null,
        },
        include: { shift: true },
      }),
    ]);

    // Fase 32b — break-time deduction. Look up the effective shift for
    // each attended day and subtract its unpaid break window from
    // `hoursWorked` before it flows into `TimesheetEntry.regularHours`.
    // We cap at zero so a mis-configured shift (break > worked) never
    // yields a negative payroll number.
    const resolveShiftForDate = (workDate: Date): (typeof shiftAssignments)[number] | null => {
      const applicable = shiftAssignments
        .filter(
          (a) =>
            a.effectiveFrom.getTime() <= workDate.getTime() &&
            (a.effectiveTo === null || a.effectiveTo.getTime() >= workDate.getTime()),
        )
        .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
      return applicable ?? null;
    };

    const attendanceByDate = new Map<string, AttendanceInput>();
    for (const a of attendance) {
      const key = toYmd(a.workDate, timezone);
      const rawHours =
        a.clockOutAt && a.clockInAt
          ? (a.clockOutAt.getTime() - a.clockInAt.getTime()) / 3_600_000
          : 0;
      const assignment = resolveShiftForDate(a.workDate);
      const breakHours = assignment ? (assignment.shift.breakMinutes ?? 0) / 60 : 0;
      const hoursWorked = round2(Math.max(0, rawHours - breakHours));
      attendanceByDate.set(key, {
        workDate: key,
        clockInAt: a.clockInAt,
        clockOutAt: a.clockOutAt,
        hoursWorked,
        lateMinutes: a.lateMinutes,
        earlyLeaveMinutes: a.earlyLeaveMinutes,
        attendanceId: a.id,
      });
    }

    const overtimesByDate = new Map<string, OvertimeInput[]>();
    for (const o of overtimes) {
      const key = toYmd(o.workDate, timezone);
      const list = overtimesByDate.get(key) ?? [];
      list.push({
        workDate: key,
        hours: Number(o.hours),
        overtimeId: o.id,
      });
      overtimesByDate.set(key, list);
    }

    const leaveByDate = new Map<string, LeaveDayInput>();
    for (const l of leaves) {
      const startKey = toYmd(l.startDate, timezone);
      const endKey = toYmd(l.endDate, timezone);
      for (const key of dateRangeKeys(startKey, endKey)) {
        // Skip days outside the period.
        const dateOnly = new Date(key + 'T00:00:00Z');
        if (
          dateOnly.getTime() < periodStart.getTime() ||
          dateOnly.getTime() > periodEnd.getTime()
        ) {
          continue;
        }
        leaveByDate.set(key, {
          workDate: key,
          leaveTypeName: l.leaveType.name,
          hours: 8, // Assume 8h/day for the leave — refined per-shift in 32b.
          leaveId: l.id,
        });
      }
    }

    const absenceByDate = new Map<string, AbsenceInput>();
    for (const a of absences) {
      const key = toYmd(a.workDate, timezone);
      absenceByDate.set(key, {
        workDate: key,
        absenceId: a.id,
        reason: a.reason,
      });
    }

    // Resolve the shift used to compute *expected* hours for a given
    // day. Fase 32b — expected hours are net of break time, so a
    // regular workday matches what the entry-builder allocates to
    // `regularHours` (the attendance mapping above already subtracts
    // the break).
    const shiftInputForDate = (workDate: Date): ShiftAssignmentInput | null => {
      const applicable = resolveShiftForDate(workDate);
      if (!applicable) return null;
      const start = parseHhmm(applicable.shift.startTime);
      const end = parseHhmm(applicable.shift.endTime);
      const breakMin = applicable.shift.breakMinutes ?? 0;
      const hours = round2(Math.max(0, (end - start - breakMin) / 60));
      return {
        hoursPerWorkingDay: hours,
        workingWeekdays: new Set([1, 2, 3, 4, 5]),
      };
    };

    const builtEntries: BuiltEntry[] = [];
    for (const workDate of eachDayInclusive(periodStart, periodEnd)) {
      const key = toYmd(workDate, timezone);
      const shift = shiftInputForDate(workDate);
      const weekday = tzWeekday(workDate, timezone);
      const input: BuildEntryInput = {
        workDate: key,
        weekday,
        shift,
        attendance: attendanceByDate.get(key) ?? null,
        overtimes: overtimesByDate.get(key) ?? [],
        leaveDay: leaveByDate.get(key) ?? null,
        absence: absenceByDate.get(key) ?? null,
        holiday: holidayByDate.get(key) ?? null,
      };
      builtEntries.push(buildEntry(input));
    }

    const totals = rollupTimesheet(builtEntries);

    // Persist the whole thing atomically. We wipe existing entries
    // and re-insert them so a regenerate can add/remove rows without
    // orphaning old ones.
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.timesheet.findUnique({
        where: { userId_periodId: { userId, periodId } },
      });

      const timesheet = existing
        ? await tx.timesheet.update({
            where: { id: existing.id },
            data: {
              ...totals,
              totalRegularHours: new Prisma.Decimal(totals.totalRegularHours),
              totalOvertimeHours: new Prisma.Decimal(totals.totalOvertimeHours),
              generatedAt: new Date(),
            },
          })
        : await tx.timesheet.create({
            data: {
              companyId,
              userId,
              periodId,
              ...totals,
              totalRegularHours: new Prisma.Decimal(totals.totalRegularHours),
              totalOvertimeHours: new Prisma.Decimal(totals.totalOvertimeHours),
              generatedAt: new Date(),
            },
          });

      await tx.timesheetEntry.deleteMany({
        where: { timesheetId: timesheet.id },
      });

      if (builtEntries.length > 0) {
        await tx.timesheetEntry.createMany({
          data: builtEntries.map((e) => ({
            timesheetId: timesheet.id,
            workDate: new Date(e.workDate + 'T00:00:00Z'),
            kind: e.kind,
            expectedHours: e.expectedHours === null ? null : new Prisma.Decimal(e.expectedHours),
            regularHours: new Prisma.Decimal(e.regularHours),
            overtimeHours: new Prisma.Decimal(e.overtimeHours),
            leaveHours: new Prisma.Decimal(e.leaveHours),
            lateMinutes: e.lateMinutes,
            earlyLeaveMinutes: e.earlyLeaveMinutes,
            sourceRefs:
              Object.keys(e.sourceRefs).length > 0
                ? (e.sourceRefs as Prisma.InputJsonValue)
                : undefined,
            note: e.note,
          })),
        });
      }
    });
  }

  // ---------- READ endpoints ----------

  async listForUser(userId: string, companyId: string, limit = 12): Promise<TimesheetSummary[]> {
    const rows = await this.prisma.timesheet.findMany({
      where: { userId, companyId },
      orderBy: { period: { periodEnd: 'desc' } },
      take: limit,
      include: {
        period: true,
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            department: { select: { name: true } },
          },
        },
      },
    });
    return rows.map(toSummary);
  }

  async getDetail(actor: AuthenticatedUser, timesheetId: string): Promise<TimesheetView> {
    const ts = await this.prisma.timesheet.findUnique({
      where: { id: timesheetId },
      include: {
        period: true,
        entries: { orderBy: { workDate: 'asc' } },
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            department: { select: { name: true } },
            supervisorId: true,
            companyId: true,
          },
        },
      },
    });
    if (!ts) throw new NotFoundException('TIMESHEET_NOT_FOUND');
    this.assertVisible(actor, {
      userId: ts.userId,
      companyId: ts.companyId,
      supervisorId: ts.user.supervisorId,
    });
    return toView(ts);
  }

  async getCurrentForUser(
    actor: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<TimesheetView | null> {
    const config = await this.configService.getForCompany(actor.companyId);
    const period = calculatePeriod(now, {
      periodType: config.periodType,
      weekStartDay: config.weekStartDay,
      biweeklyAnchor: config.biweeklyAnchor,
      cutoffDayOfMonth: config.cutoffDayOfMonth,
      timezone: config.timezone,
    });
    const row = await this.prisma.timesheet.findFirst({
      where: {
        userId: actor.id,
        companyId: actor.companyId,
        period: {
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
        },
      },
      include: {
        period: true,
        entries: { orderBy: { workDate: 'asc' } },
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            department: { select: { name: true } },
            supervisorId: true,
            companyId: true,
          },
        },
      },
    });
    if (!row) return null;
    return toView(row);
  }

  async listAdmin(
    actor: AuthenticatedUser,
    filter: {
      periodId?: string;
      departmentId?: string;
      userId?: string;
      status?: TimesheetStatus | TimesheetStatus[];
    },
    limit = 50,
    offset = 0,
  ): Promise<{ items: TimesheetSummary[]; total: number }> {
    const where: Prisma.TimesheetWhereInput = { companyId: actor.companyId };

    if (filter.periodId) where.periodId = filter.periodId;
    if (filter.userId) where.userId = filter.userId;
    if (filter.status) {
      where.status = Array.isArray(filter.status) ? { in: filter.status } : filter.status;
    }

    // Supervisors only see their direct reports; HR sees everyone.
    if (actor.role === 'SUPERVISOR') {
      where.user = { supervisorId: actor.id };
    } else if (actor.role === 'EMPLOYEE') {
      throw new ForbiddenException('FORBIDDEN');
    }

    if (filter.departmentId) {
      where.user = {
        ...(where.user as Prisma.UserWhereInput | undefined),
        departmentId: filter.departmentId,
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.timesheet.findMany({
        where,
        orderBy: [{ period: { periodEnd: 'desc' } }, { userId: 'asc' }],
        take: limit,
        skip: offset,
        include: {
          period: true,
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              department: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.timesheet.count({ where }),
    ]);

    return {
      items: items.map(toSummary),
      total,
    };
  }

  async listPeriods(
    companyId: string,
    limit = 24,
  ): Promise<Array<{ id: string; periodStart: string; periodEnd: string; label: string }>> {
    const rows = await this.prisma.timesheetPeriod.findMany({
      where: { companyId },
      orderBy: { periodEnd: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      periodStart: toYmdUtc(r.periodStart),
      periodEnd: toYmdUtc(r.periodEnd),
      label: r.label,
    }));
  }

  private assertVisible(
    actor: AuthenticatedUser,
    target: {
      userId: string;
      companyId: string;
      supervisorId: string | null;
    },
  ): void {
    if (target.companyId !== actor.companyId) {
      // Cross-tenant peek — same NotFound so we don't leak existence.
      throw new NotFoundException('TIMESHEET_NOT_FOUND');
    }
    if (actor.id === target.userId) return;
    if (actor.role === 'HR_MANAGER' || actor.role === 'SUPER_ADMIN') return;
    if (actor.role === 'SUPERVISOR' && target.supervisorId === actor.id) {
      return;
    }
    throw new ForbiddenException('FORBIDDEN');
  }
}

// ---------- helpers ----------

function toSummary(row: {
  id: string;
  periodId: string;
  totalRegularHours: Prisma.Decimal;
  totalOvertimeHours: Prisma.Decimal;
  totalLeaveDays: number;
  totalAbsentDays: number;
  totalHolidays: number;
  totalWorkingDays: number;
  totalLateMinutes: number;
  totalEarlyLeaveMinutes: number;
  generatedAt: Date;
  status: TimesheetStatus;
  submittedAt: Date | null;
  rejectionReason: string | null;
  reopenCount: number;
  lastReopenedAt: Date | null;
  lastReopenReason: string | null;
  period: { periodStart: Date; periodEnd: Date; label: string };
  user: {
    id: string;
    fullName: string;
    email: string;
    department: { name: string } | null;
  };
}): TimesheetSummary {
  return {
    id: row.id,
    periodId: row.periodId,
    periodStart: toYmdUtc(row.period.periodStart),
    periodEnd: toYmdUtc(row.period.periodEnd),
    periodLabel: row.period.label,
    user: {
      id: row.user.id,
      fullName: row.user.fullName,
      email: row.user.email,
      departmentName: row.user.department?.name ?? null,
    },
    totals: {
      regularHours: Number(row.totalRegularHours),
      overtimeHours: Number(row.totalOvertimeHours),
      leaveDays: row.totalLeaveDays,
      absentDays: row.totalAbsentDays,
      holidays: row.totalHolidays,
      workingDays: row.totalWorkingDays,
      lateMinutes: row.totalLateMinutes,
      earlyLeaveMinutes: row.totalEarlyLeaveMinutes,
    },
    generatedAt: row.generatedAt.toISOString(),
    status: row.status,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason,
    reopenCount: row.reopenCount,
    lastReopenedAt: row.lastReopenedAt?.toISOString() ?? null,
    lastReopenReason: row.lastReopenReason,
  };
}

function toView(row: {
  id: string;
  periodId: string;
  totalRegularHours: Prisma.Decimal;
  totalOvertimeHours: Prisma.Decimal;
  totalLeaveDays: number;
  totalAbsentDays: number;
  totalHolidays: number;
  totalWorkingDays: number;
  totalLateMinutes: number;
  totalEarlyLeaveMinutes: number;
  generatedAt: Date;
  status: TimesheetStatus;
  submittedAt: Date | null;
  supervisorNote: string | null;
  hrManagerNote: string | null;
  rejectionReason: string | null;
  reopenCount: number;
  lastReopenedAt: Date | null;
  lastReopenReason: string | null;
  period: { periodStart: Date; periodEnd: Date; label: string };
  entries: Array<{
    workDate: Date;
    kind: TimesheetEntryKind;
    expectedHours: Prisma.Decimal | null;
    regularHours: Prisma.Decimal;
    overtimeHours: Prisma.Decimal;
    leaveHours: Prisma.Decimal;
    lateMinutes: number;
    earlyLeaveMinutes: number;
    note: string | null;
  }>;
  user: {
    id: string;
    fullName: string;
    email: string;
    department: { name: string } | null;
  };
}): TimesheetView {
  return {
    ...toSummary(row),
    supervisorNote: row.supervisorNote,
    hrManagerNote: row.hrManagerNote,
    entries: row.entries.map((e) => ({
      workDate: toYmdUtc(e.workDate),
      kind: e.kind,
      expectedHours: e.expectedHours === null ? null : Number(e.expectedHours),
      regularHours: Number(e.regularHours),
      overtimeHours: Number(e.overtimeHours),
      leaveHours: Number(e.leaveHours),
      lateMinutes: e.lateMinutes,
      earlyLeaveMinutes: e.earlyLeaveMinutes,
      note: e.note,
    })),
  };
}

function toYmd(instant: Date, timezone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(instant).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function toYmdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function tzWeekday(instant: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  });
  switch (dtf.format(instant)) {
    case 'Sun':
      return 0;
    case 'Mon':
      return 1;
    case 'Tue':
      return 2;
    case 'Wed':
      return 3;
    case 'Thu':
      return 4;
    case 'Fri':
      return 5;
    case 'Sat':
      return 6;
    default:
      return -1;
  }
}

function* eachDayInclusive(start: Date, end: Date): Iterable<Date> {
  const s = new Date(start.getTime());
  while (s.getTime() <= end.getTime()) {
    yield new Date(s.getTime());
    s.setUTCDate(s.getUTCDate() + 1);
  }
}

function dateRangeKeys(startKey: string, endKey: string): string[] {
  const out: string[] = [];
  const s = new Date(startKey + 'T00:00:00Z');
  const e = new Date(endKey + 'T00:00:00Z');
  while (s.getTime() <= e.getTime()) {
    out.push(s.toISOString().slice(0, 10));
    s.setUTCDate(s.getUTCDate() + 1);
  }
  return out;
}

function parseHhmm(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m ?? '0');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
