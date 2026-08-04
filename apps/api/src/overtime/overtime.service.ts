import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Company, OvertimeRequest, Prisma } from '@prisma/client';
import { Prisma as PrismaNs } from '@prisma/client';

import { PayrollLockedError, assertPayrollNotLocked } from '../common/domain/payroll-lock';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  overtimeApproved,
  overtimeRejected,
  overtimeSubmitted,
} from '../notification/domain/templates';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';

import { assertOvertimeHours, roundHours } from './domain/overtime-hours';
import {
  OvertimeRateError,
  classifyDay,
  computeOvertimeRate,
  type CompanyOvertimePolicy,
} from './domain/overtime-rate';
import {
  ForbiddenTransitionError,
  IllegalTransitionError,
  transition,
} from './domain/overtime-state';

export interface SubmitOvertimeInput {
  workDate: string; // YYYY-MM-DD
  hours: number;
  reason: string;
}

export interface DecideOvertimeInput {
  action: 'APPROVE' | 'REJECT';
  note?: string;
}

export interface HydratedOvertime {
  request: OvertimeRequest;
  userFullName?: string;
  dayKind: 'WEEKDAY' | 'WEEKEND' | 'HOLIDAY';
}

/**
 * Statuses that "reserve" a work date so a user cannot re-submit for the same
 * calendar day. `REJECTED` / `CANCELLED` are terminal and don't reserve.
 */
const ACTIVE_STATUSES: PrismaNs.OvertimeRequestWhereInput['status'] = {
  in: ['PENDING_APPROVAL', 'APPROVED', 'COMPLETED'],
};

@Injectable()
export class OvertimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // ---------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------
  async submit(actor: AuthenticatedUser, input: SubmitOvertimeInput): Promise<OvertimeRequest> {
    const workDate = parseCalendarDateUtc(input.workDate);
    if (!workDate) throw new BadRequestException('INVALID_DATE');

    // ---- Load user + company policy in one round-trip. --------------------
    const user = await this.prisma.user.findFirst({
      where: { id: actor.id, companyId: actor.companyId, deletedAt: null },
      include: { company: true },
    });
    if (!user || !user.company) throw new NotFoundException('USER_NOT_FOUND');
    const company = user.company;

    // ---- Rule: payroll cutoff. --------------------------------------------
    // Refuse any submit that lands on a frozen date. Ordered BEFORE the
    // future-date guard so operators see the more actionable error
    // ("payroll locked") first when both apply — a locked date is by
    // definition not in the future, so there's no overlap in practice.
    this.assertPayrollNotLocked(actor, workDate, company.payrollLockedUntil);

    // ---- Rule: workDate cannot be in the future (would fake unearned pay). -
    const todayUtc = truncUtcDay(new Date());
    if (workDate.getTime() > todayUtc.getTime()) {
      throw new BadRequestException('WORK_DATE_IN_FUTURE');
    }

    // ---- Rule: workDate must fall inside the submit window. ---------------
    const windowStart = new Date(todayUtc);
    windowStart.setUTCDate(windowStart.getUTCDate() - company.overtimeSubmitWindowDays);
    if (workDate.getTime() < windowStart.getTime()) {
      throw new BadRequestException('OUTSIDE_SUBMIT_WINDOW');
    }

    // ---- Rule: hours within the company cap. -------------------------------
    const maxHours = decimalToNumber(company.overtimeMaxHoursPerDay);
    try {
      assertOvertimeHours({ hours: input.hours, maxHoursPerDay: maxHours });
    } catch (e) {
      const code = (e as { code?: string }).code ?? 'HOURS_INVALID';
      throw new BadRequestException(code);
    }
    const hours = roundHours(input.hours);

    // ---- Rule: no active OT for the same date. ----------------------------
    const dup = await this.prisma.overtimeRequest.findFirst({
      where: {
        userId: actor.id,
        companyId: actor.companyId,
        workDate,
        status: ACTIVE_STATUSES,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (dup) throw new ConflictException('DUPLICATE_WORK_DATE');

    // ---- Fetch holidays around workDate (single-day window). ---------------
    const holidays = await this.prisma.holiday.findMany({
      where: { companyId: actor.companyId, date: workDate },
      select: { date: true },
    });
    const holidaySet = new Set(holidays.map((h) => toIsoDate(h.date)));

    // ---- Compute rate. ----------------------------------------------------
    const policy: CompanyOvertimePolicy = {
      hourlyRate: nullableDecimalToNumber(company.overtimeHourlyRate),
      weekdayMultiplier: decimalToNumber(company.overtimeWeekdayMultiplier),
      weekendMultiplier: decimalToNumber(company.overtimeWeekendMultiplier),
      holidayMultiplier: decimalToNumber(company.overtimeHolidayMultiplier),
    };
    let rate;
    try {
      rate = computeOvertimeRate({
        hours,
        workDate,
        userHourlyRateOverride: nullableDecimalToNumber(user.overtimeHourlyRate),
        companyPolicy: policy,
        holidaySet,
      });
    } catch (e) {
      if (e instanceof OvertimeRateError) {
        throw new BadRequestException(e.code);
      }
      throw e;
    }

    // ---- Persist + audit atomically. ---------------------------------------
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.overtimeRequest.create({
          data: {
            companyId: actor.companyId,
            userId: actor.id,
            workDate,
            hours: new PrismaNs.Decimal(hours),
            reason: input.reason.trim(),
            status: 'PENDING_APPROVAL',
            baseRate: new PrismaNs.Decimal(rate.baseRate),
            rateMultiplier: new PrismaNs.Decimal(rate.multiplier),
            ratePerHour: new PrismaNs.Decimal(rate.ratePerHour),
            totalAmount: new PrismaNs.Decimal(rate.totalAmount),
          },
        });
        await tx.auditLog.create({
          data: {
            companyId: actor.companyId,
            actorId: actor.id,
            action: 'OVERTIME_SUBMITTED',
            entityType: 'OvertimeRequest',
            entityId: created.id,
            afterJson: {
              workDate: input.workDate,
              hours,
              dayKind: rate.dayKind,
              ratePerHour: rate.ratePerHour,
              totalAmount: rate.totalAmount,
            } as unknown as Prisma.InputJsonValue,
          },
        });

        // Notify supervisor. If the user has no supervisor assigned, only
        // HR sees the row in the pending queue — no notification needed.
        if (user.supervisorId) {
          const supervisor = await tx.user.findUnique({
            where: { id: user.supervisorId },
            select: { email: true },
          });
          await this.notifications.createOne(
            {
              companyId: actor.companyId,
              recipientId: user.supervisorId,
              recipientEmail: supervisor?.email,
              content: overtimeSubmitted({
                overtimeRequestId: created.id,
                requesterName: user.fullName,
                workDate: input.workDate,
                hours,
              }),
            },
            tx,
          );
        }
        return created;
      });
    } catch (e) {
      // The partial unique index `OvertimeRequest_userId_workDate_active_uidx`
      // (see migration 20260801190000) catches concurrent-submit races that
      // slip past the app-level `findFirst` check above. Re-surface as the
      // same 409 code the client already handles.
      if (e instanceof PrismaNs.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('DUPLICATE_WORK_DATE');
      }
      throw e;
    }
  }

  // ---------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------
  async listMine(actor: AuthenticatedUser, year?: number): Promise<OvertimeRequest[]> {
    const where: PrismaNs.OvertimeRequestWhereInput = {
      companyId: actor.companyId,
      userId: actor.id,
      deletedAt: null,
    };
    if (year) {
      const start = new Date(Date.UTC(year, 0, 1));
      const end = new Date(Date.UTC(year + 1, 0, 1));
      where.workDate = { gte: start, lt: end };
    }
    return this.prisma.overtimeRequest.findMany({
      where,
      orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * Approvals a user can act on. `SUPERVISOR` sees their team's PENDING; `HR_MANAGER`
   * / `SUPER_ADMIN` see the whole tenant's PENDING. Employees see nothing here.
   */
  async listPendingApprovals(actor: AuthenticatedUser): Promise<OvertimeRequest[]> {
    if (actor.role === 'EMPLOYEE') return [];

    const where: PrismaNs.OvertimeRequestWhereInput = {
      companyId: actor.companyId,
      status: 'PENDING_APPROVAL',
      deletedAt: null,
    };
    if (actor.role === 'SUPERVISOR') {
      // Only their direct subordinates. HR/SUPER see everyone in the tenant.
      where.user = { supervisorId: actor.id };
    }

    return this.prisma.overtimeRequest.findMany({
      where,
      orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  // ---------------------------------------------------------------
  // Decide (approve / reject)
  // ---------------------------------------------------------------
  async decide(
    actor: AuthenticatedUser,
    id: string,
    input: DecideOvertimeInput,
  ): Promise<OvertimeRequest> {
    const existing = await this.prisma.overtimeRequest.findFirst({
      where: { id, companyId: actor.companyId, deletedAt: null },
      include: {
        user: { select: { supervisorId: true, email: true, fullName: true } },
      },
    });
    if (!existing) throw new NotFoundException('OVERTIME_NOT_FOUND');

    // Payroll cutoff: refuse decisions that would flip a request inside a
    // frozen period. Loading only the cutoff column (not the whole Company
    // row) keeps this a cheap indexed read.
    const company = await this.prisma.company.findFirst({
      where: { id: actor.companyId, deletedAt: null },
      select: { payrollLockedUntil: true },
    });
    this.assertPayrollNotLocked(actor, existing.workDate, company?.payrollLockedUntil ?? null);

    const isTeamSupervisor = existing.user.supervisorId === actor.id;
    let nextStatus;
    try {
      nextStatus = transition(existing.status, {
        kind: input.action,
        actorRole: actor.role,
        isTeamSupervisor,
      });
    } catch (e) {
      if (e instanceof ForbiddenTransitionError) {
        throw new BadRequestException(e.code);
      }
      if (e instanceof IllegalTransitionError) {
        throw new ConflictException(e.code);
      }
      throw e;
    }

    const now = new Date();
    const data: PrismaNs.OvertimeRequestUpdateInput = {
      status: nextStatus,
      decisionNote: input.note?.trim() ?? null,
      approvedById: actor.id,
      approvedAt: input.action === 'APPROVE' ? now : null,
      rejectedAt: input.action === 'REJECT' ? now : null,
    };

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.overtimeRequest.update({ where: { id }, data });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: input.action === 'APPROVE' ? 'OVERTIME_APPROVED' : 'OVERTIME_REJECTED',
          entityType: 'OvertimeRequest',
          entityId: id,
          afterJson: {
            status: nextStatus,
            note: input.note ?? null,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      // Notify the requester of the decision.
      const decider = await tx.user.findUnique({
        where: { id: actor.id },
        select: { fullName: true },
      });
      const eventInput = {
        overtimeRequestId: id,
        requesterName: existing.user.fullName,
        workDate: toIsoDate(existing.workDate),
        hours: Number(existing.hours.toString()),
        decidedByName: decider?.fullName ?? actor.email,
        note: input.note ?? null,
      };
      const content =
        input.action === 'APPROVE' ? overtimeApproved(eventInput) : overtimeRejected(eventInput);
      await this.notifications.createOne(
        {
          companyId: actor.companyId,
          recipientId: existing.userId,
          recipientEmail: existing.user.email,
          content,
        },
        tx,
      );

      return updated;
    });
  }

  // ---------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------
  async cancel(actor: AuthenticatedUser, id: string): Promise<OvertimeRequest> {
    const existing = await this.prisma.overtimeRequest.findFirst({
      where: { id, companyId: actor.companyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('OVERTIME_NOT_FOUND');

    // Payroll cutoff: forbid cancels landing inside a frozen period.
    const company = await this.prisma.company.findFirst({
      where: { id: actor.companyId, deletedAt: null },
      select: { payrollLockedUntil: true },
    });
    this.assertPayrollNotLocked(actor, existing.workDate, company?.payrollLockedUntil ?? null);

    let nextStatus;
    try {
      nextStatus = transition(existing.status, {
        kind: 'CANCEL',
        actorIsOwner: existing.userId === actor.id,
      });
    } catch (e) {
      if (e instanceof ForbiddenTransitionError) {
        throw new BadRequestException(e.code);
      }
      if (e instanceof IllegalTransitionError) {
        throw new ConflictException(e.code);
      }
      throw e;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.overtimeRequest.update({
        where: { id },
        data: { status: nextStatus },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'OVERTIME_CANCELLED',
          entityType: 'OvertimeRequest',
          entityId: id,
          afterJson: { status: nextStatus } as unknown as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
  }

  // ---------------------------------------------------------------
  // Payroll cutoff helper
  // ---------------------------------------------------------------
  /**
   * Guard mutating endpoints (submit / decide / cancel) against operating
   * on dates inside a closed payroll period. HR_MANAGER and lower are
   * blocked; SUPER_ADMIN retains an emergency-override lane.
   *
   * Wraps the framework-free `assertPayrollNotLocked` from `common/domain`
   * and adapts its `PayrollLockedError` to a `ConflictException` with a
   * stable `code = 'PAYROLL_LOCKED'` payload so the FE can render a
   * targeted message and disable subsequent actions.
   */
  private assertPayrollNotLocked(
    actor: AuthenticatedUser,
    workDate: Date,
    payrollLockedUntil: Date | null | undefined,
  ): void {
    try {
      assertPayrollNotLocked(workDate, payrollLockedUntil, { role: actor.role });
    } catch (err) {
      if (err instanceof PayrollLockedError) {
        throw new ConflictException({
          code: 'PAYROLL_LOCKED',
          cutoffDate: err.cutoffIsoDate,
        });
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------
  // Hydration for controller DTO mapping
  // ---------------------------------------------------------------
  async hydrate(
    rows: OvertimeRequest[],
    opts: { includeRequester?: boolean } = {},
  ): Promise<HydratedOvertime[]> {
    if (rows.length === 0) return [];

    let names: Map<string, string> | null = null;
    if (opts.includeRequester) {
      const userIds = [...new Set(rows.map((r) => r.userId))];
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, fullName: true },
      });
      names = new Map(users.map((u) => [u.id, u.fullName]));
    }

    // Preload holiday set once for the min→max workDate range so we can classify
    // without re-querying per row. `rows[0]` is guaranteed non-null by the
    // `rows.length === 0` short-circuit above; the local alias satisfies TS
    // strict-null-checks without a runtime cost.
    const firstRow = rows[0];
    if (!firstRow) return [];
    const min = new Date(Math.min(...rows.map((r) => r.workDate.getTime())));
    const max = new Date(Math.max(...rows.map((r) => r.workDate.getTime())));
    const holidays = await this.prisma.holiday.findMany({
      where: {
        companyId: firstRow.companyId,
        date: { gte: min, lte: max },
      },
      select: { date: true },
    });
    const holidaySet = new Set(holidays.map((h) => toIsoDate(h.date)));

    return rows.map((r) => ({
      request: r,
      userFullName: names?.get(r.userId),
      dayKind: classifyDay(r.workDate, holidaySet),
    }));
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Parse `YYYY-MM-DD` as a UTC-midnight Date. Returns null on invalid input. */
function parseCalendarDateUtc(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const parts = iso.split('-').map(Number);
  // The regex above guarantees exactly three numeric parts, but TS strict-mode
  // still treats tuple destructuring on `string[]` as possibly undefined.
  if (parts.length !== 3) return null;
  const [y, m, d] = parts as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return dt;
}

function truncUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function decimalToNumber(v: PrismaNs.Decimal): number {
  return Number(v.toString());
}

function nullableDecimalToNumber(v: PrismaNs.Decimal | null): number | null {
  return v === null ? null : Number(v.toString());
}
