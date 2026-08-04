import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LeaveBalance, LeaveRequest, LeaveType, Prisma } from '@prisma/client';
import { LeaveStatus, Prisma as PrismaNs } from '@prisma/client';

import { AttachmentService } from '../attachment/attachment.service';
import { isOwnedAttachmentKey } from '../attachment/domain/attachment-key';
import { PayrollLockedError, assertPayrollNotLocked } from '../common/domain/payroll-lock';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  leaveApprovedByHr,
  leaveApprovedBySupervisor,
  leaveRejected,
  leaveSubmitted,
} from '../notification/domain/templates';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { countBusinessDays } from './domain/business-days';
import type { CalendarDate } from './domain/calendar-date';
import { assertCalendarDate } from './domain/calendar-date';
import {
  ForbiddenTransitionError,
  IllegalTransitionError,
  transition,
} from './domain/leave-state-machine';

export interface SubmitLeaveInput {
  leaveTypeId: string;
  startDate: CalendarDate;
  endDate: CalendarDate;
  reason: string;
  /**
   * S3 object key returned by `POST /attachments/presign`. Verified against
   * the submitter's ownership prefix — a stolen key from another user is
   * rejected. The DB column is still named `attachmentUrl` for backward
   * compatibility (see `LeaveRequest.attachmentUrl`).
   */
  attachmentKey?: string;
}

export interface DecideLeaveInput {
  action: 'APPROVE' | 'REJECT';
  note?: string;
}

export interface HydratedLeaveRequest {
  request: LeaveRequest;
  leaveTypeName: string;
  leaveTypeKind: LeaveType['kind'];
  userFullName?: string;
}

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentService,
    private readonly notifications: NotificationService,
  ) {}

  // ---------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------
  async submit(user: AuthenticatedUser, input: SubmitLeaveInput): Promise<LeaveRequest> {
    assertCalendarDate(input.startDate);
    assertCalendarDate(input.endDate);
    if (input.endDate < input.startDate) {
      throw new BadRequestException('INVALID_DATE_RANGE');
    }

    await this.assertNotPayrollLocked(user, input.startDate);

    const leaveType = await this.prisma.leaveType.findFirst({
      where: { id: input.leaveTypeId, companyId: user.companyId, deletedAt: null },
    });
    if (!leaveType) {
      throw new NotFoundException('LEAVE_TYPE_NOT_FOUND');
    }
    if (leaveType.requiresAttachment && !input.attachmentKey) {
      throw new BadRequestException('ATTACHMENT_REQUIRED');
    }
    if (
      input.attachmentKey &&
      !isOwnedAttachmentKey(input.attachmentKey, user.companyId, user.id)
    ) {
      // The attachment key must belong to *this* user — a stolen key from
      // another user's presign response is rejected here.
      throw new BadRequestException('ATTACHMENT_KEY_INVALID');
    }

    const holidays = await this.loadCompanyHolidayDates(
      user.companyId,
      input.startDate,
      input.endDate,
    );
    const days = countBusinessDays(input.startDate, input.endDate, { holidays });
    if (days <= 0) {
      throw new BadRequestException('ZERO_BUSINESS_DAYS');
    }

    await this.assertNoOverlap(user.id, input.startDate, input.endDate);

    const year = Number(input.startDate.slice(0, 4));

    return this.prisma.$transaction(
      async (tx) => {
        const balance = await this.lockOrInitBalance(tx, user.id, leaveType, year);

        if (balance.remaining < days) {
          throw new BadRequestException('INSUFFICIENT_BALANCE');
        }

        await tx.leaveBalance.update({
          where: { id: balance.id },
          data: {
            reserved: { increment: days },
            remaining: { decrement: days },
            version: { increment: 1 },
          },
        });

        const supervisorId = await this.findSupervisorId(user.id);

        const created = await tx.leaveRequest.create({
          data: {
            companyId: user.companyId,
            userId: user.id,
            leaveTypeId: leaveType.id,
            status: LeaveStatus.PENDING_SUPERVISOR,
            startDate: new Date(`${input.startDate}T00:00:00.000Z`),
            endDate: new Date(`${input.endDate}T00:00:00.000Z`),
            days,
            reason: input.reason,
            attachmentUrl: input.attachmentKey,
            supervisorId,
          },
        });

        await tx.auditLog.create({
          data: {
            companyId: user.companyId,
            actorId: user.id,
            action: 'LEAVE_REQUEST_SUBMITTED',
            entityType: 'LeaveRequest',
            entityId: created.id,
            afterJson: created as unknown as Prisma.InputJsonValue,
          },
        });

        // Notify the supervisor if one exists. Best-effort inside the same
        // transaction: if the requester has no supervisor, the leave falls
        // straight to HR stage on approval, so the notification lands in
        // the decide() branch instead.
        if (supervisorId) {
          const requester = await tx.user.findUnique({
            where: { id: user.id },
            select: { fullName: true },
          });
          const supervisor = await tx.user.findUnique({
            where: { id: supervisorId },
            select: { email: true },
          });
          await this.notifications.createOne(
            {
              companyId: user.companyId,
              recipientId: supervisorId,
              recipientEmail: supervisor?.email,
              content: leaveSubmitted({
                leaveRequestId: created.id,
                requesterName: requester?.fullName ?? user.email,
                leaveTypeName: leaveType.name,
                startDate: input.startDate,
                endDate: input.endDate,
                days,
              }),
            },
            tx,
          );
        }

        return created;
      },
      { isolationLevel: PrismaNs.TransactionIsolationLevel.Serializable },
    );
  }

  // ---------------------------------------------------------------
  // Decide (approve / reject)
  // ---------------------------------------------------------------
  async decide(
    actor: AuthenticatedUser,
    requestId: string,
    input: DecideLeaveInput,
  ): Promise<LeaveRequest> {
    const existing = await this.prisma.leaveRequest.findFirst({
      where: { id: requestId, companyId: actor.companyId, deletedAt: null },
      include: { user: true },
    });
    if (!existing) throw new NotFoundException('LEAVE_REQUEST_NOT_FOUND');

    // Payroll cutoff guard — protect closed periods from state changes.
    // We look at `startDate` because the entire request is treated as
    // one unit (see `assertPayrollNotLocked` docs re: range semantics).
    await this.assertNotPayrollLockedForRequest(actor, existing.startDate);

    // Level-1 supervisor scope check: supervisor can only act on their own reports.
    if (
      existing.status === LeaveStatus.PENDING_SUPERVISOR &&
      actor.role === 'SUPERVISOR' &&
      existing.user.supervisorId !== actor.id
    ) {
      throw new ForbiddenException('FORBIDDEN');
    }

    let planned;
    try {
      planned = transition(existing.status, {
        kind: input.action,
        actorRole: actor.role,
      });
    } catch (err) {
      if (err instanceof ForbiddenTransitionError) throw new ForbiddenException('FORBIDDEN');
      if (err instanceof IllegalTransitionError) throw new ConflictException('ILLEGAL_TRANSITION');
      throw err;
    }

    const days = existing.days;
    const year = existing.startDate.getUTCFullYear();

    return this.prisma.$transaction(
      async (tx) => {
        const balance = await this.lockBalanceById(tx, existing.userId, existing.leaveTypeId, year);

        // Apply reserved/used deltas atomically.
        if (planned.reservedDelta !== 0 || planned.usedDelta !== 0) {
          const reservedChange = planned.reservedDelta * days;
          const usedChange = planned.usedDelta * days;
          const remainingChange = -(reservedChange + usedChange);

          const nextReserved = balance.reserved + reservedChange;
          const nextUsed = balance.used + usedChange;
          if (nextReserved < 0 || nextUsed < 0) {
            throw new ConflictException('BALANCE_INVARIANT_VIOLATION');
          }

          await tx.leaveBalance.update({
            where: { id: balance.id },
            data: {
              reserved: { increment: reservedChange },
              used: { increment: usedChange },
              remaining: { increment: remainingChange },
              version: { increment: 1 },
            },
          });
        }

        const isSupervisorStage = existing.status === LeaveStatus.PENDING_SUPERVISOR;
        const now = new Date();

        const updated = await tx.leaveRequest.update({
          where: { id: existing.id },
          data: {
            status: planned.next,
            supervisorId: isSupervisorStage ? actor.id : existing.supervisorId,
            supervisorAt: isSupervisorStage ? now : existing.supervisorAt,
            supervisorNote: isSupervisorStage ? input.note : existing.supervisorNote,
            hrManagerId:
              !isSupervisorStage && planned.next !== 'PENDING_HR' ? actor.id : existing.hrManagerId,
            hrManagerAt:
              !isSupervisorStage && planned.next !== 'PENDING_HR' ? now : existing.hrManagerAt,
            hrManagerNote:
              !isSupervisorStage && planned.next !== 'PENDING_HR'
                ? input.note
                : existing.hrManagerNote,
          },
        });

        await tx.auditLog.create({
          data: {
            companyId: actor.companyId,
            actorId: actor.id,
            action:
              input.action === 'APPROVE' ? 'LEAVE_REQUEST_APPROVED' : 'LEAVE_REQUEST_REJECTED',
            entityType: 'LeaveRequest',
            entityId: updated.id,
            beforeJson: existing as unknown as Prisma.InputJsonValue,
            afterJson: updated as unknown as Prisma.InputJsonValue,
          },
        });

        // Fan out notifications based on where the state machine landed.
        // We only look up the leave-type name once and reuse it for both
        // possible recipients to keep the query count bounded.
        const leaveType = await tx.leaveType.findUnique({
          where: { id: existing.leaveTypeId },
          select: { name: true },
        });
        const decider = await tx.user.findUnique({
          where: { id: actor.id },
          select: { fullName: true },
        });
        const eventInput = {
          leaveRequestId: updated.id,
          requesterName: existing.user.fullName,
          leaveTypeName: leaveType?.name ?? 'Cuti',
          startDate: existing.startDate.toISOString().slice(0, 10),
          endDate: existing.endDate.toISOString().slice(0, 10),
          days,
          decidedByName: decider?.fullName ?? actor.email,
          note: input.note ?? null,
        };

        if (input.action === 'APPROVE' && planned.next === 'PENDING_HR') {
          // Supervisor approved → notify the employee that their request is
          // now with HR. (HR discovers new items via the pending queue —
          // notifying every HR manager on each supervisor approval creates
          // noise for busy tenants.)
          await this.notifications.createOne(
            {
              companyId: actor.companyId,
              recipientId: existing.userId,
              recipientEmail: existing.user.email,
              content: leaveApprovedBySupervisor(eventInput),
            },
            tx,
          );
        } else if (input.action === 'APPROVE' && planned.next === 'APPROVED') {
          await this.notifications.createOne(
            {
              companyId: actor.companyId,
              recipientId: existing.userId,
              recipientEmail: existing.user.email,
              content: leaveApprovedByHr(eventInput),
            },
            tx,
          );
        } else if (input.action === 'REJECT') {
          await this.notifications.createOne(
            {
              companyId: actor.companyId,
              recipientId: existing.userId,
              recipientEmail: existing.user.email,
              content: leaveRejected(eventInput),
            },
            tx,
          );
        }

        return updated;
      },
      { isolationLevel: PrismaNs.TransactionIsolationLevel.Serializable },
    );
  }

  // ---------------------------------------------------------------
  // Cancel (owner only)
  // ---------------------------------------------------------------
  async cancel(actor: AuthenticatedUser, requestId: string): Promise<LeaveRequest> {
    const existing = await this.prisma.leaveRequest.findFirst({
      where: { id: requestId, companyId: actor.companyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('LEAVE_REQUEST_NOT_FOUND');
    if (existing.userId !== actor.id) throw new ForbiddenException('FORBIDDEN');

    // Payroll cutoff guard — an employee cannot rescind leave that
    // already landed inside a closed period (which would silently add
    // paid days back to a finalized paycheck). SUPER_ADMIN bypass still
    // applies via `assertNotPayrollLockedForRequest`.
    await this.assertNotPayrollLockedForRequest(actor, existing.startDate);

    let planned;
    try {
      planned = transition(existing.status, { kind: 'CANCEL' });
    } catch (err) {
      if (err instanceof IllegalTransitionError) throw new ConflictException('ILLEGAL_TRANSITION');
      throw err;
    }

    const days = existing.days;
    const year = existing.startDate.getUTCFullYear();

    return this.prisma.$transaction(
      async (tx) => {
        const balance = await this.lockBalanceById(tx, existing.userId, existing.leaveTypeId, year);
        const reservedChange = planned.reservedDelta * days;

        await tx.leaveBalance.update({
          where: { id: balance.id },
          data: {
            reserved: { increment: reservedChange },
            remaining: { increment: -reservedChange },
            version: { increment: 1 },
          },
        });

        const updated = await tx.leaveRequest.update({
          where: { id: existing.id },
          data: { status: planned.next },
        });

        await tx.auditLog.create({
          data: {
            companyId: actor.companyId,
            actorId: actor.id,
            action: 'LEAVE_REQUEST_CANCELLED',
            entityType: 'LeaveRequest',
            entityId: updated.id,
            beforeJson: existing as unknown as Prisma.InputJsonValue,
            afterJson: updated as unknown as Prisma.InputJsonValue,
          },
        });

        return updated;
      },
      { isolationLevel: PrismaNs.TransactionIsolationLevel.Serializable },
    );
  }

  // ---------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------
  async listMine(user: AuthenticatedUser, year?: number): Promise<LeaveRequest[]> {
    return this.prisma.leaveRequest.findMany({
      where: {
        companyId: user.companyId,
        userId: user.id,
        deletedAt: null,
        ...(year
          ? {
              startDate: {
                gte: new Date(Date.UTC(year, 0, 1)),
                lt: new Date(Date.UTC(year + 1, 0, 1)),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Pending requests visible to the caller based on their role:
   *   SUPERVISOR   → PENDING_SUPERVISOR requests from their reports
   *   HR_MANAGER   → PENDING_HR requests across the company
   *   SUPER_ADMIN  → both stages
   *   EMPLOYEE     → forbidden
   */
  async listPendingApprovals(actor: AuthenticatedUser): Promise<LeaveRequest[]> {
    if (actor.role === 'EMPLOYEE') {
      throw new ForbiddenException('FORBIDDEN');
    }

    const where: Prisma.LeaveRequestWhereInput = {
      companyId: actor.companyId,
      deletedAt: null,
    };

    if (actor.role === 'SUPERVISOR') {
      where.status = LeaveStatus.PENDING_SUPERVISOR;
      where.user = { supervisorId: actor.id };
    } else if (actor.role === 'HR_MANAGER') {
      where.status = LeaveStatus.PENDING_HR;
    } else {
      where.status = { in: [LeaveStatus.PENDING_SUPERVISOR, LeaveStatus.PENDING_HR] };
    }

    return this.prisma.leaveRequest.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });
  }

  async getBalances(user: AuthenticatedUser, year?: number): Promise<LeaveBalance[]> {
    const targetYear = year ?? new Date().getUTCFullYear();
    return this.prisma.leaveBalance.findMany({
      where: { userId: user.id, year: targetYear },
      include: { leaveType: true },
      orderBy: { leaveType: { code: 'asc' } },
    });
  }

  async listAvailableTypes(user: AuthenticatedUser): Promise<
    Array<{
      id: string;
      code: string;
      name: string;
      kind: LeaveType['kind'];
      requiresAttachment: boolean;
    }>
  > {
    return this.prisma.leaveType.findMany({
      where: { companyId: user.companyId, deletedAt: null },
      select: { id: true, code: true, name: true, kind: true, requiresAttachment: true },
      orderBy: { code: 'asc' },
    });
  }

  /**
   * Enrich a list of LeaveRequests with related leave-type names and (optionally) requester names.
   * Kept in the service so the controller stays free of Prisma access.
   */
  async hydrateRequests(
    rows: LeaveRequest[],
    options: { includeRequester?: boolean } = {},
  ): Promise<Array<HydratedLeaveRequest>> {
    if (rows.length === 0) return [];

    const typeIds = [...new Set(rows.map((r) => r.leaveTypeId))];
    const types = await this.prisma.leaveType.findMany({
      where: { id: { in: typeIds } },
      select: { id: true, name: true, kind: true },
    });
    const typeById = new Map(types.map((t) => [t.id, t]));

    let userById: Map<string, { fullName: string }> | null = null;
    if (options.includeRequester) {
      const userIds = [...new Set(rows.map((r) => r.userId))];
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, fullName: true },
      });
      userById = new Map(users.map((u) => [u.id, { fullName: u.fullName }]));
    }

    return rows.map((r) => ({
      request: r,
      leaveTypeName: typeById.get(r.leaveTypeId)?.name ?? 'Unknown',
      leaveTypeKind: typeById.get(r.leaveTypeId)?.kind ?? 'OTHER',
      userFullName: userById?.get(r.userId)?.fullName,
    }));
  }

  // ---------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------
  private async lockOrInitBalance(
    tx: Prisma.TransactionClient,
    userId: string,
    leaveType: LeaveType,
    year: number,
  ): Promise<LeaveBalance> {
    // Try FOR UPDATE first — most common path.
    const locked = await tx.$queryRaw<LeaveBalance[]>`
      SELECT * FROM "LeaveBalance"
      WHERE "userId" = ${userId}
        AND "leaveTypeId" = ${leaveType.id}
        AND "year" = ${year}
      FOR UPDATE
    `;
    if (locked[0]) return locked[0];

    // First submission of the year for this leave type → seed a fresh balance row.
    const created = await tx.leaveBalance.create({
      data: {
        userId,
        leaveTypeId: leaveType.id,
        year,
        quota: leaveType.defaultAnnualQuota,
        used: 0,
        reserved: 0,
        carriedOver: 0,
        remaining: leaveType.defaultAnnualQuota,
      },
    });
    // Immediately lock the row we just created (concurrent inserts would raise a unique violation which is fine).
    const relocked = await tx.$queryRaw<LeaveBalance[]>`
      SELECT * FROM "LeaveBalance" WHERE "id" = ${created.id} FOR UPDATE
    `;
    return relocked[0] ?? created;
  }

  private async lockBalanceById(
    tx: Prisma.TransactionClient,
    userId: string,
    leaveTypeId: string,
    year: number,
  ): Promise<LeaveBalance> {
    const rows = await tx.$queryRaw<LeaveBalance[]>`
      SELECT * FROM "LeaveBalance"
      WHERE "userId" = ${userId}
        AND "leaveTypeId" = ${leaveTypeId}
        AND "year" = ${year}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) throw new ConflictException('BALANCE_MISSING');
    return row;
  }

  // ---------------------------------------------------------------
  // Payroll cutoff helpers
  // ---------------------------------------------------------------
  /**
   * Check whether `startIso` (as CalendarDate) is inside the tenant's
   * frozen payroll window. Throws ConflictException with code
   * `PAYROLL_LOCKED` when it is and the actor is not SUPER_ADMIN.
   *
   * Used by `submit` — the request has not been persisted yet, so we
   * carry the raw CalendarDate string.
   */
  private async assertNotPayrollLocked(
    actor: AuthenticatedUser,
    startIso: CalendarDate,
  ): Promise<void> {
    const company = await this.prisma.company.findFirst({
      where: { id: actor.companyId, deletedAt: null },
      select: { payrollLockedUntil: true },
    });
    const cutoff = company?.payrollLockedUntil ?? null;
    try {
      assertPayrollNotLocked(new Date(`${startIso}T00:00:00.000Z`), cutoff, {
        role: actor.role,
      });
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

  /**
   * Variant used by `decide` / `cancel` where the LeaveRequest is
   * already loaded — accepts the persisted `Date` (start of the range)
   * directly to save a stringify → parse round-trip.
   */
  private async assertNotPayrollLockedForRequest(
    actor: AuthenticatedUser,
    startDate: Date,
  ): Promise<void> {
    const company = await this.prisma.company.findFirst({
      where: { id: actor.companyId, deletedAt: null },
      select: { payrollLockedUntil: true },
    });
    const cutoff = company?.payrollLockedUntil ?? null;
    try {
      assertPayrollNotLocked(startDate, cutoff, { role: actor.role });
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

  private async findSupervisorId(userId: string): Promise<string | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { supervisorId: true },
    });
    return u?.supervisorId ?? null;
  }

  private async assertNoOverlap(
    userId: string,
    start: CalendarDate,
    end: CalendarDate,
  ): Promise<void> {
    const overlap = await this.prisma.leaveRequest.findFirst({
      where: {
        userId,
        deletedAt: null,
        status: {
          in: [LeaveStatus.PENDING_SUPERVISOR, LeaveStatus.PENDING_HR, LeaveStatus.APPROVED],
        },
        startDate: { lte: new Date(`${end}T23:59:59.999Z`) },
        endDate: { gte: new Date(`${start}T00:00:00.000Z`) },
      },
      select: { id: true },
    });
    if (overlap) throw new ConflictException('OVERLAPPING_REQUEST');
  }

  private async loadCompanyHolidayDates(
    companyId: string,
    start: CalendarDate,
    end: CalendarDate,
  ): Promise<CalendarDate[]> {
    const rows = await this.prisma.holiday.findMany({
      where: {
        companyId,
        date: {
          gte: new Date(`${start}T00:00:00.000Z`),
          lte: new Date(`${end}T23:59:59.999Z`),
        },
      },
      select: { date: true },
    });
    return rows.map((r) => r.date.toISOString().slice(0, 10) as CalendarDate);
  }
}
