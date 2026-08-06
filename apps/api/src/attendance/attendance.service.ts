import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AttendanceRecord, Prisma } from '@prisma/client';
import { AbsenceSource, AttendanceEventType, AttendanceStatus } from '@prisma/client';

import { PayrollLockedError, assertPayrollNotLocked } from '../common/domain/payroll-lock';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { attendanceAbsentMarked } from '../notification/domain/templates';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  summarizeAttendance,
  type AttendanceMonthlySummary,
  type AttendanceSummaryStatus,
} from './domain/attendance-summary';
import { buildCompanySnapshot, type CompanySnapshot } from './domain/dashboard-snapshot';
import { checkGeofence } from './domain/geofence';
import { evaluateClockIn, evaluateClockOut } from './domain/shift-timing';
import {
  buildTeamDailyView,
  buildTeamSummary,
  type RosterMember,
  type TeamMemberDailyRow,
  type TeamMemberSummaryRow,
} from './domain/team-attendance';
import type { ClockInDto } from './dto/clock-in.dto';
import type { ClockOutDto } from './dto/clock-out.dto';

export interface HistoryQuery {
  /** Inclusive lower bound `YYYY-MM-DD`. Defaults to 90 days ago. */
  from?: string;
  /** Inclusive upper bound `YYYY-MM-DD`. Defaults to today. */
  to?: string;
  /** Page size, 1..200. Defaults to 60 (~ 3 months of weekdays). */
  limit?: number;
}

export interface MonthQuery {
  /** 4-digit year. Defaults to current UTC year. */
  year?: number;
  /** 1..12. Defaults to current UTC month. */
  month?: number;
}

export interface TeamRangeQuery {
  from?: string;
  to?: string;
}

export interface DashboardQuery {
  /** ISO YYYY-MM-DD (UTC). Defaults to today. */
  date?: string;
}

export interface CompanyDashboardResponse extends CompanySnapshot {
  /** Echo the resolved date so the caller doesn't need to guess. */
  date: string;
}

export interface TeamDailyQuery {
  /** `YYYY-MM-DD` — defaults to today (UTC). */
  date?: string;
}

export interface MarkAbsentInput {
  userId: string;
  /** `YYYY-MM-DD` calendar date the user was absent. */
  workDate: string;
  /**
   * Free-text audit note captured on the AbsenceRecord row. Max 500 chars
   * (validated at DTO layer). Optional — HR may prefer to leave blank
   * for quick corrections.
   */
  reason?: string;
}

const HISTORY_MAX_DAYS = 366;
const HISTORY_DEFAULT_LIMIT = 60;
const HISTORY_MAX_LIMIT = 200;

/**
 * Team-summary range must be bounded — an HR manager scanning the whole
 * tenant for a year would materialize thousands of rows unnecessarily.
 */
const TEAM_SUMMARY_MAX_DAYS = 92;
const TEAM_SUMMARY_DEFAULT_DAYS = 7; // one calendar week

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Record a clock-in event. Executes server-side geofence check, computes lateness,
   * creates an AttendanceRecord and its first AttendanceEvent + AuditLog in a single tx.
   */
  async clockIn(user: AuthenticatedUser, dto: ClockInDto): Promise<AttendanceRecord> {
    const now = new Date();
    const workDate = truncateToUtcDate(now);

    const assignment = await this.prisma.userShiftAssignment.findFirst({
      where: {
        userId: user.id,
        deletedAt: null,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
      include: {
        shift: { include: { geofence: true, company: true } },
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (!assignment) {
      throw new NotFoundException('SHIFT_NOT_FOUND');
    }
    if (assignment.shift.companyId !== user.companyId) {
      throw new ForbiddenException('FORBIDDEN');
    }

    const geofence = assignment.shift.geofence;
    if (!geofence) {
      throw new BadRequestException('SHIFT_NOT_FOUND');
    }

    const gate = this.assertLocationAllowed(dto, geofence);

    const existing = await this.prisma.attendanceRecord.findUnique({
      where: { userId_workDate: { userId: user.id, workDate } },
    });
    if (existing) {
      throw new ConflictException('ALREADY_CLOCKED_IN');
    }

    const timing = evaluateClockIn(now, workDate, {
      startTime: assignment.shift.startTime,
      endTime: assignment.shift.endTime,
      graceMinutes: assignment.shift.graceMinutes,
      timezone: assignment.shift.company.timezone,
    });

    return this.prisma.$transaction(async (tx) => {
      const record = await tx.attendanceRecord.create({
        data: {
          companyId: user.companyId,
          userId: user.id,
          shiftId: assignment.shiftId,
          workDate,
          clockInAt: now,
          clockInLatitude: dto.latitude,
          clockInLongitude: dto.longitude,
          clockInAccuracyM: Math.round(dto.accuracyMeters),
          status: timing.status === 'LATE' ? AttendanceStatus.LATE : AttendanceStatus.ON_TIME,
          lateMinutes: timing.lateMinutes,
          note: dto.note,
        },
      });

      await tx.attendanceEvent.create({
        data: {
          attendanceId: record.id,
          type: AttendanceEventType.CLOCK_IN,
          occurredAt: now,
          latitude: dto.latitude,
          longitude: dto.longitude,
          accuracyMeters: Math.round(dto.accuracyMeters),
          distanceMeters: gate.distanceMeters,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId: user.companyId,
          actorId: user.id,
          action: 'ATTENDANCE_CLOCK_IN',
          entityType: 'AttendanceRecord',
          entityId: record.id,
          afterJson: record as unknown as Prisma.InputJsonValue,
        },
      });

      return record;
    });
  }

  async clockOut(user: AuthenticatedUser, dto: ClockOutDto): Promise<AttendanceRecord> {
    const now = new Date();
    const workDate = truncateToUtcDate(now);

    const record = await this.prisma.attendanceRecord.findUnique({
      where: { userId_workDate: { userId: user.id, workDate } },
      include: { shift: { include: { geofence: true, company: true } } },
    });

    if (!record) {
      throw new NotFoundException('NOT_CLOCKED_IN');
    }
    if (record.companyId !== user.companyId) {
      throw new ForbiddenException('FORBIDDEN');
    }
    if (record.clockOutAt) {
      throw new ConflictException('CONFLICT');
    }

    const geofence = record.shift.geofence;
    if (!geofence) {
      throw new BadRequestException('SHIFT_NOT_FOUND');
    }

    const gate = this.assertLocationAllowed(dto, geofence);

    const timing = evaluateClockOut(now, workDate, {
      startTime: record.shift.startTime,
      endTime: record.shift.endTime,
      graceMinutes: record.shift.graceMinutes,
      timezone: record.shift.company.timezone,
    });

    const nextStatus: AttendanceStatus =
      timing.earlyLeaveMinutes > 0 ? AttendanceStatus.EARLY_LEAVE : record.status;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.attendanceRecord.update({
        where: { id: record.id },
        data: {
          clockOutAt: now,
          clockOutLatitude: dto.latitude,
          clockOutLongitude: dto.longitude,
          clockOutAccuracyM: Math.round(dto.accuracyMeters),
          earlyLeaveMinutes: timing.earlyLeaveMinutes,
          status: nextStatus,
        },
      });

      await tx.attendanceEvent.create({
        data: {
          attendanceId: updated.id,
          type: AttendanceEventType.CLOCK_OUT,
          occurredAt: now,
          latitude: dto.latitude,
          longitude: dto.longitude,
          accuracyMeters: Math.round(dto.accuracyMeters),
          distanceMeters: gate.distanceMeters,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId: user.companyId,
          actorId: user.id,
          action: 'ATTENDANCE_CLOCK_OUT',
          entityType: 'AttendanceRecord',
          entityId: updated.id,
          beforeJson: record as unknown as Prisma.InputJsonValue,
          afterJson: updated as unknown as Prisma.InputJsonValue,
        },
      });

      return updated;
    });
  }

  async findMyToday(user: AuthenticatedUser): Promise<AttendanceRecord | null> {
    const workDate = truncateToUtcDate(new Date());
    return this.prisma.attendanceRecord.findUnique({
      where: { userId_workDate: { userId: user.id, workDate } },
    });
  }

  /**
   * Employee's own attendance history. Bounded to at most `HISTORY_MAX_DAYS`
   * days of range and `HISTORY_MAX_LIMIT` rows returned — a page-size
   * ceiling protects against a rogue client asking for the entire tenant
   * history in one shot.
   */
  async listMyHistory(user: AuthenticatedUser, q: HistoryQuery = {}): Promise<AttendanceRecord[]> {
    const today = truncateToUtcDate(new Date());
    const to = q.to ? (parseIsoDate(q.to) ?? today) : today;
    const defaultFrom = new Date(to);
    defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 89); // 90-day window inclusive
    const from = q.from ? (parseIsoDate(q.from) ?? defaultFrom) : defaultFrom;

    if (from > to) {
      throw new BadRequestException('INVALID_RANGE');
    }
    const spanDays = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (spanDays > HISTORY_MAX_DAYS) {
      throw new BadRequestException('RANGE_TOO_WIDE');
    }

    const limit = clampInt(q.limit ?? HISTORY_DEFAULT_LIMIT, 1, HISTORY_MAX_LIMIT);

    return this.prisma.attendanceRecord.findMany({
      where: {
        userId: user.id,
        companyId: user.companyId,
        deletedAt: null,
        workDate: { gte: from, lte: to },
      },
      orderBy: { workDate: 'desc' },
      take: limit,
    });
  }

  /**
   * Employee's own monthly summary. Query loads all rows for the target
   * month (max ~31 rows per user, cheap), then applies the pure
   * `summarizeAttendance` reducer. This is the workhorse behind the
   * "This month at a glance" dashboard card.
   */
  async getMyMonthlySummary(
    user: AuthenticatedUser,
    q: MonthQuery = {},
  ): Promise<AttendanceMonthlySummary & { year: number; month: number }> {
    const now = new Date();
    const year = q.year ?? now.getUTCFullYear();
    const month = q.month ?? now.getUTCMonth() + 1;

    if (!Number.isInteger(year) || year < 2000 || year > 3000) {
      throw new BadRequestException('INVALID_YEAR');
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('INVALID_MONTH');
    }

    const rangeStart = new Date(Date.UTC(year, month - 1, 1));
    const rangeEnd = new Date(Date.UTC(year, month, 1)); // exclusive upper bound

    const [rows, absentCount] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: {
          userId: user.id,
          companyId: user.companyId,
          deletedAt: null,
          workDate: { gte: rangeStart, lt: rangeEnd },
        },
        select: {
          status: true,
          clockInAt: true,
          clockOutAt: true,
          lateMinutes: true,
          earlyLeaveMinutes: true,
        },
      }),
      this.prisma.absenceRecord.count({
        where: {
          userId: user.id,
          companyId: user.companyId,
          workDate: { gte: rangeStart, lt: rangeEnd },
        },
      }),
    ]);

    const summary = summarizeAttendance(
      rows.map((r) => ({
        status: r.status as AttendanceSummaryStatus,
        clockInAt: r.clockInAt,
        clockOutAt: r.clockOutAt,
        lateMinutes: r.lateMinutes,
        earlyLeaveMinutes: r.earlyLeaveMinutes,
      })),
      { absentDaysCount: absentCount },
    );
    return { year, month, ...summary };
  }

  // -----------------------------------------------------------------------
  // Supervisor / HR — team views
  // -----------------------------------------------------------------------

  /**
   * "Who from my team clocked in today?"
   *
   * Scoping rules:
   *   - `SUPERVISOR` → only their direct reports (`supervisorId = actor.id`).
   *   - `HR_MANAGER`, `SUPER_ADMIN` → whole tenant.
   *   - `EMPLOYEE` → 403 (they can call `/me/*` instead).
   *
   * The result includes users with **no** AttendanceRecord for the date —
   * they show up as `NOT_CLOCKED_IN` so the supervisor sees the whole
   * roster, not just the people who showed up.
   */
  async listTeamToday(
    actor: AuthenticatedUser,
    q: TeamDailyQuery = {},
  ): Promise<TeamMemberDailyRow[]> {
    this.assertTeamViewer(actor);

    const targetDate = q.date ? parseIsoDate(q.date) : truncateToUtcDate(new Date());
    if (!targetDate) throw new BadRequestException('INVALID_DATE');

    // ---- Roster ----------------------------------------------------------
    const roster = await this.loadRoster(actor);
    if (roster.length === 0) return [];

    const rosterIds = roster.map((r) => r.userId);

    // ---- Attendance / absence / leave overlays for the exact date -------
    const [rows, absences, approvedLeaves] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: {
          companyId: actor.companyId,
          deletedAt: null,
          workDate: targetDate,
          userId: { in: rosterIds },
        },
        select: {
          userId: true,
          status: true,
          clockInAt: true,
          clockOutAt: true,
          lateMinutes: true,
          earlyLeaveMinutes: true,
        },
      }),
      this.prisma.absenceRecord.findMany({
        where: {
          companyId: actor.companyId,
          workDate: targetDate,
          userId: { in: rosterIds },
        },
        select: { id: true, userId: true, source: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          companyId: actor.companyId,
          status: 'APPROVED',
          deletedAt: null,
          startDate: { lte: targetDate },
          endDate: { gte: targetDate },
          userId: { in: rosterIds },
        },
        select: { userId: true },
      }),
    ]);

    return buildTeamDailyView(roster, rows, {
      absences: absences.map((a) => ({
        userId: a.userId,
        absenceRecordId: a.id,
        source: a.source,
      })),
      onLeaveUserIds: approvedLeaves.map((l) => l.userId),
    });
  }

  /**
   * Per-member roll-up over a bounded date range (default: last 7 days).
   * Used by the supervisor "team summary" tab — surfaces on-time %, total
   * late minutes, and hours per person so managers can spot outliers.
   */
  async getTeamSummary(
    actor: AuthenticatedUser,
    q: TeamRangeQuery = {},
  ): Promise<{ from: string; to: string; rows: TeamMemberSummaryRow[] }> {
    this.assertTeamViewer(actor);

    const today = truncateToUtcDate(new Date());
    const to = q.to ? (parseIsoDate(q.to) ?? today) : today;
    const defaultFrom = new Date(to);
    defaultFrom.setUTCDate(defaultFrom.getUTCDate() - (TEAM_SUMMARY_DEFAULT_DAYS - 1));
    const from = q.from ? (parseIsoDate(q.from) ?? defaultFrom) : defaultFrom;
    if (!from || !to) throw new BadRequestException('INVALID_DATE');

    if (from > to) throw new BadRequestException('INVALID_RANGE');
    const spanDays = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (spanDays > TEAM_SUMMARY_MAX_DAYS) {
      throw new BadRequestException('RANGE_TOO_WIDE');
    }

    const roster = await this.loadRoster(actor);
    if (roster.length === 0) {
      return { from: toIsoDate(from), to: toIsoDate(to), rows: [] };
    }

    const rosterIds = roster.map((r) => r.userId);
    const [rows, absenceCounts] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: {
          companyId: actor.companyId,
          deletedAt: null,
          userId: { in: rosterIds },
          workDate: { gte: from, lte: to },
        },
        select: {
          userId: true,
          status: true,
          clockInAt: true,
          clockOutAt: true,
          lateMinutes: true,
          earlyLeaveMinutes: true,
        },
      }),
      this.prisma.absenceRecord.groupBy({
        by: ['userId'],
        where: {
          companyId: actor.companyId,
          userId: { in: rosterIds },
          workDate: { gte: from, lte: to },
        },
        _count: { _all: true },
      }),
    ]);

    const absentDaysByUserId: Record<string, number> = {};
    for (const row of absenceCounts) {
      absentDaysByUserId[row.userId] = row._count._all;
    }

    return {
      from: toIsoDate(from),
      to: toIsoDate(to),
      rows: buildTeamSummary(roster, rows, { absentDaysByUserId }),
    };
  }

  /**
   * Company-wide attendance snapshot for a given date. Powers the HR
   * dashboard. RBAC is tighter than the team views — supervisors can
   * only see their reports (via `listTeamToday`), but the *company*
   * snapshot is strictly HR / Super Admin.
   */
  async getCompanyDashboard(
    actor: AuthenticatedUser,
    q: DashboardQuery = {},
  ): Promise<CompanyDashboardResponse> {
    this.assertHrOrSuper(actor);

    const targetDate = q.date ? parseIsoDate(q.date) : truncateToUtcDate(new Date());
    if (!targetDate) throw new BadRequestException('INVALID_DATE');

    // Full company roster — every ACTIVE + ON_LEAVE user regardless of
    // supervisor. We deliberately include `ON_LEAVE` employees because a
    // dashboard should reflect them (they contribute to the ON_LEAVE
    // bucket, not vanish from the headcount).
    const roster = await this.prisma.user.findMany({
      where: {
        companyId: actor.companyId,
        deletedAt: null,
        employmentStatus: { in: ['ACTIVE', 'ON_LEAVE'] },
      },
      select: {
        id: true,
        departmentId: true,
        department: { select: { name: true } },
      },
    });
    if (roster.length === 0) {
      return {
        date: toIsoDate(targetDate),
        total: 0,
        clockedIn: 0,
        absent: 0,
        onLeave: 0,
        notClockedIn: 0,
        lateToday: 0,
        earlyLeaveToday: 0,
        onTimeRatePercent: null,
        departments: [],
      };
    }
    const rosterIds = roster.map((r) => r.id);

    const [attendance, absences, approvedLeaves] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: {
          companyId: actor.companyId,
          deletedAt: null,
          workDate: targetDate,
          userId: { in: rosterIds },
        },
        select: {
          userId: true,
          status: true,
          lateMinutes: true,
          earlyLeaveMinutes: true,
        },
      }),
      this.prisma.absenceRecord.findMany({
        where: {
          companyId: actor.companyId,
          workDate: targetDate,
          userId: { in: rosterIds },
        },
        select: { userId: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          companyId: actor.companyId,
          status: 'APPROVED',
          deletedAt: null,
          startDate: { lte: targetDate },
          endDate: { gte: targetDate },
          userId: { in: rosterIds },
        },
        select: { userId: true },
      }),
    ]);

    const snapshot = buildCompanySnapshot(
      roster.map((r) => ({
        userId: r.id,
        departmentId: r.departmentId,
        departmentName: r.department?.name ?? null,
      })),
      attendance,
      absences,
      approvedLeaves.map((l) => l.userId),
    );

    return { date: toIsoDate(targetDate), ...snapshot };
  }

  // -----------------------------------------------------------------------
  // Manual HR override — mark / unmark an absence
  // -----------------------------------------------------------------------

  /**
   * HR (or Super Admin) marks a user absent on a specific date manually.
   *
   * Fires when a user forgot to file leave and HR wants to record the
   * absence definitively (payroll deduction, audit trail). Also useful
   * on-boarding of legacy records: HR can retroactively fill in absences
   * that predate the auto-scheduler's rollout.
   *
   * Invariants enforced:
   *
   * 1. **Tenant isolation.** The target `userId` MUST belong to the actor's
   *    company. Cross-tenant marking is a hard 404 (deliberately not
   *    exposing existence of foreign tenant IDs).
   * 2. **No future dates.** `workDate` > today is `INVALID_DATE`. Past-only
   *    to keep the semantics "record what happened", not "predict".
   * 3. **Cannot mark a clocked-in day.** If an `AttendanceRecord` exists for
   *    `(userId, workDate)` we refuse with `CLOCKED_IN`. HR must delete
   *    the attendance record first (via a different flow) — protects
   *    against accidental clobbering of real clock data.
   * 4. **Idempotent-on-duplicate.** If an AbsenceRecord already exists
   *    (either AUTO or MANUAL), we return `ALREADY_MARKED` — HR can
   *    delete and re-create if they want to change reason/source.
   */
  async markAbsent(
    actor: AuthenticatedUser,
    input: MarkAbsentInput,
  ): Promise<{
    id: string;
    userId: string;
    workDate: string;
    source: AbsenceSource;
    reason: string | null;
    markedById: string | null;
    createdAt: string;
  }> {
    this.assertHrOrSuper(actor);

    const workDate = parseIsoDate(input.workDate);
    if (!workDate) throw new BadRequestException('INVALID_DATE');
    const today = truncateToUtcDate(new Date());
    if (workDate.getTime() > today.getTime()) {
      throw new BadRequestException('DATE_IN_FUTURE');
    }

    // 1. Tenant + existence check on the target user.
    //    We load the Company row inline to get the payroll cutoff without a
    //    second roundtrip — the tenant is already resolved via `actor`.
    const [target, company] = await Promise.all([
      this.prisma.user.findFirst({
        where: {
          id: input.userId,
          companyId: actor.companyId,
          deletedAt: null,
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          supervisorId: true,
          supervisor: { select: { id: true, email: true } },
          hiredAt: true,
        },
      }),
      this.prisma.company.findFirst({
        where: { id: actor.companyId, deletedAt: null },
        select: { payrollLockedUntil: true },
      }),
    ]);
    if (!target) throw new NotFoundException('USER_NOT_FOUND');

    if (target.hiredAt.getTime() > workDate.getTime()) {
      throw new BadRequestException('NOT_HIRED_YET');
    }

    // Payroll cutoff — refuse HR writes inside frozen periods.
    // SUPER_ADMIN retains an emergency override (see ADR-0010).
    try {
      assertPayrollNotLocked(workDate, company?.payrollLockedUntil ?? null, {
        role: actor.role,
      });
    } catch (e) {
      if (e instanceof PayrollLockedError) {
        throw new ConflictException({
          code: 'PAYROLL_LOCKED',
          message: 'PAYROLL_LOCKED',
          cutoffDate: e.cutoffIsoDate,
        });
      }
      throw e;
    }

    // 2. No pre-existing attendance for the same date.
    const attendance = await this.prisma.attendanceRecord.findFirst({
      where: {
        userId: target.id,
        workDate,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (attendance) throw new ConflictException('CLOCKED_IN');

    // 3. No pre-existing absence.
    const existing = await this.prisma.absenceRecord.findFirst({
      where: { userId: target.id, workDate },
      select: { id: true, source: true },
    });
    if (existing) throw new ConflictException('ALREADY_MARKED');

    // 4. Create + notify.
    const reason = input.reason?.trim();
    const created = await this.prisma.absenceRecord.create({
      data: {
        companyId: actor.companyId,
        userId: target.id,
        workDate,
        source: AbsenceSource.MANUAL_HR,
        reason: reason && reason.length > 0 ? reason.slice(0, 500) : null,
        markedById: actor.id,
      },
    });

    // Audit log — best-effort, never blocks the primary action.
    await this.prisma.auditLog
      .create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'ATTENDANCE_MARK_ABSENT',
          entityType: 'AbsenceRecord',
          entityId: created.id,
          afterJson: {
            userId: target.id,
            workDate: input.workDate,
            source: 'MANUAL_HR',
            reason: created.reason,
          } as unknown as Prisma.InputJsonValue,
        },
      })
      .catch((err) => {
        this.logger.warn(
          `manual-absent audit log failed for id=${created.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

    // Notifications: employee + supervisor (same template as scheduler).
    const isoWorkDate = toIsoDate(workDate);
    await this.notifications
      .createOne({
        companyId: actor.companyId,
        recipientId: target.id,
        recipientEmail: target.email,
        content: attendanceAbsentMarked({
          workDate: isoWorkDate,
          employeeName: target.fullName,
          forSupervisor: false,
        }),
      })
      .catch((err) =>
        this.logger.warn(
          `manual-absent notify employee failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
    if (target.supervisor?.id) {
      await this.notifications
        .createOne({
          companyId: actor.companyId,
          recipientId: target.supervisor.id,
          recipientEmail: target.supervisor.email,
          content: attendanceAbsentMarked({
            workDate: isoWorkDate,
            employeeName: target.fullName,
            forSupervisor: true,
          }),
        })
        .catch((err) =>
          this.logger.warn(
            `manual-absent notify supervisor failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
    }

    return {
      id: created.id,
      userId: created.userId,
      workDate: toIsoDate(created.workDate),
      source: created.source,
      reason: created.reason,
      markedById: created.markedById,
      createdAt: created.createdAt.toISOString(),
    };
  }

  /**
   * HR removes an existing AbsenceRecord — used to correct a keliru
   * scheduler classification (e.g. user was actually on urgent leave)
   * or to walk back a manual mark. Hard delete because the audit log
   * (`ATTENDANCE_UNMARK_ABSENT`) preserves the history.
   *
   * Invariants:
   *
   * - **Tenant isolation.** The record's `companyId` must match `actor`'s.
   *   404 otherwise (do not leak cross-tenant existence).
   * - **Idempotent-friendly.** Deleting a non-existent id returns 404;
   *   the FE is expected to gracefully hide the button after the first
   *   successful delete.
   */
  async deleteAbsence(actor: AuthenticatedUser, id: string): Promise<void> {
    this.assertHrOrSuper(actor);

    const [row, company] = await Promise.all([
      this.prisma.absenceRecord.findFirst({
        where: { id, companyId: actor.companyId },
        select: {
          id: true,
          userId: true,
          workDate: true,
          source: true,
          user: { select: { id: true, email: true, companyId: true } },
        },
      }),
      this.prisma.company.findFirst({
        where: { id: actor.companyId, deletedAt: null },
        select: { payrollLockedUntil: true },
      }),
    ]);
    if (!row) throw new NotFoundException('ABSENCE_NOT_FOUND');

    // Payroll cutoff — refuse deletes inside frozen periods too.
    // Symmetric with `markAbsent`: both create AND destroy operations
    // must be blocked once payroll has closed. SUPER_ADMIN bypasses.
    try {
      assertPayrollNotLocked(row.workDate, company?.payrollLockedUntil ?? null, {
        role: actor.role,
      });
    } catch (e) {
      if (e instanceof PayrollLockedError) {
        throw new ConflictException({
          code: 'PAYROLL_LOCKED',
          message: 'PAYROLL_LOCKED',
          cutoffDate: e.cutoffIsoDate,
        });
      }
      throw e;
    }

    await this.prisma.absenceRecord.delete({ where: { id: row.id } });

    await this.prisma.auditLog
      .create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'ATTENDANCE_UNMARK_ABSENT',
          entityType: 'AbsenceRecord',
          entityId: row.id,
          beforeJson: {
            userId: row.userId,
            workDate: toIsoDate(row.workDate),
            source: row.source,
          } as unknown as Prisma.InputJsonValue,
        },
      })
      .catch((err) => {
        this.logger.warn(
          `absence-delete audit log failed for id=${row.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /**
   * Server-side gate that decides whether a submitted clock-in/out
   * payload is allowed to land against the given geofence. The
   * checks stack in priority order:
   *
   * 1. **Accuracy budget** — if the geofence declares
   *    `maxAccuracyMeters`, reject when the device-reported
   *    `accuracyMeters` exceeds it (`WEAK_GPS_ACCURACY`). This
   *    keeps devices that are essentially IP-geolocating from
   *    "landing" a garbage coordinate that happens to fall inside
   *    the fence.
   *
   * 2. **Wi-Fi SSID fallback** — if the geofence declares
   *    `allowedSsids` and the client reports a matching one, the
   *    distance check is bypassed. This is the escape hatch for
   *    indoor GPS-hostile buildings; only the mobile app can
   *    provide `wifiSsid` — browsers cannot.
   *
   * 3. **Haversine distance** — the classic circle-membership
   *    check. Throws `OUTSIDE_GEOFENCE` when the pin lands outside
   *    the radius.
   *
   * The order is important: accuracy is checked BEFORE the fallback
   * so a spoofed SSID can never grant access from a device that's
   * clearly IP-geolocating. All rejections carry a stable `code`
   * suitable for the FE to switch on.
   */
  private assertLocationAllowed(
    dto: { latitude: number; longitude: number; accuracyMeters: number; wifiSsid?: string },
    geofence: {
      latitude: { toNumber: () => number };
      longitude: { toNumber: () => number };
      radiusMeters: number;
      maxAccuracyMeters: number | null;
      allowedSsids: string[];
    },
  ): { distanceMeters: number; via: 'GEOFENCE' | 'WIFI_SSID' } {
    if (geofence.maxAccuracyMeters !== null && dto.accuracyMeters > geofence.maxAccuracyMeters) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'WEAK_GPS_ACCURACY',
        message: `Akurasi GPS perangkat Anda (${Math.round(dto.accuracyMeters)}m) melebihi batas yang ditetapkan admin (${geofence.maxAccuracyMeters}m). Coba pindah ke dekat jendela atau lokasi terbuka.`,
      });
    }

    // We compute distance in ALL branches so the AttendanceEvent
    // history always carries a meaningful `distanceMeters`, even
    // when the SSID fallback granted access. That gives HR a way
    // to spot "SSID lets them in but they're 3km away" edge cases
    // in the Geofence Health dashboard.
    const result = checkGeofence(
      { latitude: dto.latitude, longitude: dto.longitude },
      {
        center: {
          latitude: geofence.latitude.toNumber(),
          longitude: geofence.longitude.toNumber(),
        },
        radiusMeters: geofence.radiusMeters,
      },
    );

    if (
      dto.wifiSsid &&
      geofence.allowedSsids.length > 0 &&
      geofence.allowedSsids.includes(dto.wifiSsid.trim())
    ) {
      return { distanceMeters: result.distanceMeters, via: 'WIFI_SSID' };
    }

    if (!result.inside) {
      throw new ForbiddenException('OUTSIDE_GEOFENCE');
    }
    return { distanceMeters: result.distanceMeters, via: 'GEOFENCE' };
  }

  private assertHrOrSuper(actor: AuthenticatedUser): void {
    if (actor.role !== 'HR_MANAGER' && actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('FORBIDDEN');
    }
  }

  private assertTeamViewer(actor: AuthenticatedUser): void {
    if (
      actor.role !== 'SUPERVISOR' &&
      actor.role !== 'HR_MANAGER' &&
      actor.role !== 'SUPER_ADMIN'
    ) {
      throw new ForbiddenException('FORBIDDEN');
    }
  }

  /**
   * Resolve the set of users the actor is allowed to see. Never returns a
   * user from another tenant even if the caller is `SUPER_ADMIN` — cross-tenant
   * access is deliberately not modelled at this API surface.
   */
  private async loadRoster(actor: AuthenticatedUser): Promise<RosterMember[]> {
    const where: Prisma.UserWhereInput = {
      companyId: actor.companyId,
      deletedAt: null,
      // Only active people should show up on the "who's in" view.
      employmentStatus: { notIn: ['SUSPENDED', 'TERMINATED'] },
    };
    if (actor.role === 'SUPERVISOR') {
      where.supervisorId = actor.id;
    }

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        email: true,
        department: { select: { name: true } },
      },
      orderBy: { fullName: 'asc' },
    });

    return users.map((u) => ({
      userId: u.id,
      fullName: u.fullName,
      email: u.email,
      departmentName: u.department?.name ?? null,
    }));
  }
}

function parseIsoDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const parts = s.split('-').map(Number) as [number, number, number];
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return dt;
}

function clampInt(n: number, min: number, max: number): number {
  const r = Math.floor(n);
  return Math.max(min, Math.min(max, r));
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Returns midnight-UTC of the given instant (Prisma `@db.Date` expects a UTC-midnight Date). */
function truncateToUtcDate(instant: Date): Date {
  return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
}
