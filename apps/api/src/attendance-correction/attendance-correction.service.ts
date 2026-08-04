import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AttendanceCorrection, AttendanceCorrectionStatus, Prisma } from '@prisma/client';
import { Prisma as PrismaNs } from '@prisma/client';

import { AttachmentService } from '../attachment/attachment.service';
import { isOwnedAttachmentKey } from '../attachment/domain/attachment-key';
import { PayrollLockedError, assertPayrollNotLocked } from '../common/domain/payroll-lock';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  attendanceCorrectionApproved,
  attendanceCorrectionRejected,
  attendanceCorrectionSubmitted,
} from '../notification/domain/templates';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { TimesheetService } from '../timesheet/timesheet.service';

import { planCorrectionApply } from './domain/apply-correction';
import type { ApplyCorrectionAction } from './domain/apply-correction';
import {
  ForbiddenCorrectionTransitionError,
  IllegalCorrectionTransitionError,
  transition,
} from './domain/correction-state';

export interface SubmitCorrectionInput {
  /** YYYY-MM-DD calendar date the correction applies to. */
  workDate: string;
  /** ISO 8601 datetime; null means "no correction to this side". */
  requestedClockInAt: string | null;
  requestedClockOutAt: string | null;
  reason: string;
  attachmentKey?: string;
}

export interface DecideCorrectionInput {
  action: 'APPROVE' | 'REJECT';
  note?: string;
}

export interface HydratedCorrection {
  request: AttendanceCorrection;
  userFullName?: string;
}

@Injectable()
export class AttendanceCorrectionService {
  private readonly logger = new Logger(AttendanceCorrectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentService,
    private readonly notifications: NotificationService,
    private readonly timesheet: TimesheetService,
  ) {}

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------
  async submit(
    actor: AuthenticatedUser,
    input: SubmitCorrectionInput,
  ): Promise<AttendanceCorrection> {
    const workDate = parseCalendarDateUtc(input.workDate);
    if (!workDate) throw new BadRequestException('INVALID_DATE');

    // Future dates: refuse — the auto-scheduler / clock-in service handles
    // the current day; there's no correction to make for a date that hasn't
    // happened yet.
    const todayUtc = truncUtcDay(new Date());
    if (workDate.getTime() > todayUtc.getTime()) {
      throw new BadRequestException('DATE_IN_FUTURE');
    }

    const requestedClockInAt = input.requestedClockInAt ? new Date(input.requestedClockInAt) : null;
    const requestedClockOutAt = input.requestedClockOutAt
      ? new Date(input.requestedClockOutAt)
      : null;

    if (!requestedClockInAt && !requestedClockOutAt) {
      throw new BadRequestException('AT_LEAST_ONE_TIME');
    }

    // Time-of-day sanity: both requested times must fall on `workDate` in
    // UTC. Otherwise the correction implicitly modifies a different day —
    // which the DB partial-uniqueness on (userId, workDate) wouldn't catch.
    for (const [label, t] of [
      ['requestedClockInAt', requestedClockInAt],
      ['requestedClockOutAt', requestedClockOutAt],
    ] as const) {
      if (t && truncUtcDay(t).getTime() !== workDate.getTime()) {
        throw new BadRequestException(`${label.toUpperCase()}_OUT_OF_DAY`);
      }
    }

    // Load actor's user row + company for hiring date + payroll cutoff.
    // Selecting only the fields we need keeps this a bounded read.
    const user = await this.prisma.user.findFirst({
      where: { id: actor.id, companyId: actor.companyId, deletedAt: null },
      select: {
        id: true,
        supervisorId: true,
        hiredAt: true,
        company: { select: { payrollLockedUntil: true } },
      },
    });
    if (!user) throw new NotFoundException('USER_NOT_FOUND');

    if (user.hiredAt && workDate.getTime() < truncUtcDay(user.hiredAt).getTime()) {
      throw new BadRequestException('BEFORE_HIRED_AT');
    }

    // Payroll cutoff — mirror leave/overtime behavior (Phase 18 refactor).
    this.assertPayrollNotLocked(actor, workDate, user.company?.payrollLockedUntil ?? null);

    if (
      input.attachmentKey &&
      !isOwnedAttachmentKey(input.attachmentKey, actor.companyId, actor.id, 'attendance-correction')
    ) {
      throw new BadRequestException('ATTACHMENT_KEY_INVALID');
    }

    // Prevent a stampede of duplicate PENDING corrections against the same
    // (userId, workDate). The user has to decide/cancel the outstanding one
    // first — otherwise approving two would race on the apply step.
    const existingPending = await this.prisma.attendanceCorrection.findFirst({
      where: {
        userId: actor.id,
        workDate,
        status: 'PENDING_APPROVAL',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existingPending) throw new ConflictException('DUPLICATE_PENDING');

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.attendanceCorrection.create({
        data: {
          companyId: actor.companyId,
          userId: actor.id,
          workDate,
          requestedClockInAt,
          requestedClockOutAt,
          reason: input.reason.trim(),
          attachmentUrl: input.attachmentKey,
          status: 'PENDING_APPROVAL',
          supervisorId: user.supervisorId,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'ATTENDANCE_CORRECTION_SUBMITTED',
          entityType: 'AttendanceCorrection',
          entityId: row.id,
          afterJson: row as unknown as Prisma.InputJsonValue,
        },
      });

      // Notify the supervisor if one exists; if not, the row still sits in
      // the HR / SUPER_ADMIN pending queue which they poll independently.
      if (user.supervisorId) {
        const [requester, supervisor] = await Promise.all([
          tx.user.findUnique({
            where: { id: actor.id },
            select: { fullName: true, email: true },
          }),
          tx.user.findUnique({
            where: { id: user.supervisorId },
            select: { email: true },
          }),
        ]);
        await this.notifications.createOne(
          {
            companyId: actor.companyId,
            recipientId: user.supervisorId,
            recipientEmail: supervisor?.email,
            content: attendanceCorrectionSubmitted({
              correctionId: row.id,
              requesterName: requester?.fullName ?? actor.email,
              workDate: input.workDate,
              requestedSummary: summarizeRequestedTimes(requestedClockInAt, requestedClockOutAt),
            }),
          },
          tx,
        );
      }

      return row;
    });

    return created;
  }

  // -------------------------------------------------------------------------
  // Decide (approve / reject)
  // -------------------------------------------------------------------------
  async decide(
    actor: AuthenticatedUser,
    id: string,
    input: DecideCorrectionInput,
  ): Promise<AttendanceCorrection> {
    const existing = await this.prisma.attendanceCorrection.findFirst({
      where: { id, companyId: actor.companyId, deletedAt: null },
      include: {
        user: {
          select: { supervisorId: true, email: true, fullName: true },
        },
      },
    });
    if (!existing) throw new NotFoundException('CORRECTION_NOT_FOUND');

    // Cutoff: reject if workDate lives inside a closed payroll period.
    const company = await this.prisma.company.findFirst({
      where: { id: actor.companyId, deletedAt: null },
      select: { payrollLockedUntil: true },
    });
    this.assertPayrollNotLocked(actor, existing.workDate, company?.payrollLockedUntil ?? null);

    let nextStatus: AttendanceCorrectionStatus;
    try {
      nextStatus = transition(existing.status, {
        kind: input.action,
        actorRole: actor.role,
        isTeamSupervisor: existing.user.supervisorId === actor.id,
      });
    } catch (err) {
      if (err instanceof ForbiddenCorrectionTransitionError) {
        throw new ForbiddenException(err.code);
      }
      if (err instanceof IllegalCorrectionTransitionError) {
        throw new ConflictException(err.code);
      }
      throw err;
    }

    const now = new Date();
    const summary = summarizeRequestedTimes(
      existing.requestedClockInAt,
      existing.requestedClockOutAt,
    );

    const updated = await this.prisma.$transaction(
      async (tx) => {
        // If APPROVE: apply the correction to AttendanceRecord FIRST, so any
        // conflict surfaces as a 409 without leaving the row in a torn state.
        if (input.action === 'APPROVE') {
          // Fase 32b — refuse if the timesheet covering this day is
          // already APPROVED. Doing this INSIDE the tx keeps us safe
          // from an HR-approves-timesheet race running concurrently.
          await this.timesheet.assertCorrectionAllowed(
            tx,
            existing.companyId,
            existing.userId,
            existing.workDate,
          );

          const attendance = await tx.attendanceRecord.findFirst({
            where: {
              userId: existing.userId,
              companyId: existing.companyId,
              workDate: existing.workDate,
            },
            select: {
              id: true,
              clockInAt: true,
              clockOutAt: true,
              deletedAt: true,
            },
          });
          const action = planCorrectionApply(attendance, {
            requestedClockInAt: existing.requestedClockInAt,
            requestedClockOutAt: existing.requestedClockOutAt,
          });
          await this.executeApplyAction(tx, existing, action);
        }

        const updated = await tx.attendanceCorrection.update({
          where: { id },
          data: {
            status: nextStatus,
            decidedById: actor.id,
            decidedAt: now,
            decisionNote: input.note?.trim() ?? null,
          },
        });

        await tx.auditLog.create({
          data: {
            companyId: actor.companyId,
            actorId: actor.id,
            action:
              input.action === 'APPROVE'
                ? 'ATTENDANCE_CORRECTION_APPROVED'
                : 'ATTENDANCE_CORRECTION_REJECTED',
            entityType: 'AttendanceCorrection',
            entityId: id,
            beforeJson: existing as unknown as Prisma.InputJsonValue,
            afterJson: updated as unknown as Prisma.InputJsonValue,
          },
        });

        const decider = await tx.user.findUnique({
          where: { id: actor.id },
          select: { fullName: true },
        });
        const templateInput = {
          correctionId: id,
          requesterName: existing.user.fullName,
          workDate: toIsoDate(existing.workDate),
          requestedSummary: summary,
          decidedByName: decider?.fullName ?? actor.email,
          note: input.note ?? null,
        };
        const content =
          input.action === 'APPROVE'
            ? attendanceCorrectionApproved(templateInput)
            : attendanceCorrectionRejected(templateInput);
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
      },
      { isolationLevel: PrismaNs.TransactionIsolationLevel.Serializable },
    );

    // Fase 32b — trigger a downstream regenerate of the affected user's
    // timesheet AFTER the correction commits. Kept outside the tx so a
    // regenerate failure doesn't roll back the correction (which is a
    // legitimate business decision on its own). The regenerate is
    // idempotent — a subsequent HR "regenerate period" fixes any gap.
    if (input.action === 'APPROVE') {
      try {
        await this.timesheet.regenerateForCorrection(
          existing.companyId,
          existing.userId,
          existing.workDate,
        );
      } catch (err) {
        this.logger.error(
          `Timesheet regenerate after correction ${id} failed`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }

    return updated;
  }

  // -------------------------------------------------------------------------
  // Cancel (owner only)
  // -------------------------------------------------------------------------
  async cancel(actor: AuthenticatedUser, id: string): Promise<AttendanceCorrection> {
    const existing = await this.prisma.attendanceCorrection.findFirst({
      where: { id, companyId: actor.companyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('CORRECTION_NOT_FOUND');

    // Cutoff — an owner cannot silently retract a request that lived
    // inside a closed period, even though a PENDING correction has no
    // payroll effect yet: keeps the audit story consistent.
    const company = await this.prisma.company.findFirst({
      where: { id: actor.companyId, deletedAt: null },
      select: { payrollLockedUntil: true },
    });
    this.assertPayrollNotLocked(actor, existing.workDate, company?.payrollLockedUntil ?? null);

    let nextStatus: AttendanceCorrectionStatus;
    try {
      nextStatus = transition(existing.status, {
        kind: 'CANCEL',
        actorIsOwner: existing.userId === actor.id,
      });
    } catch (err) {
      if (err instanceof ForbiddenCorrectionTransitionError) {
        throw new ForbiddenException(err.code);
      }
      if (err instanceof IllegalCorrectionTransitionError) {
        throw new ConflictException(err.code);
      }
      throw err;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.attendanceCorrection.update({
        where: { id },
        data: { status: nextStatus },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'ATTENDANCE_CORRECTION_CANCELLED',
          entityType: 'AttendanceCorrection',
          entityId: id,
          beforeJson: existing as unknown as Prisma.InputJsonValue,
          afterJson: updated as unknown as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------
  async listMine(actor: AuthenticatedUser): Promise<AttendanceCorrection[]> {
    return this.prisma.attendanceCorrection.findMany({
      where: {
        companyId: actor.companyId,
        userId: actor.id,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async listPendingApprovals(actor: AuthenticatedUser): Promise<AttendanceCorrection[]> {
    if (actor.role === 'EMPLOYEE') {
      throw new ForbiddenException('FORBIDDEN');
    }
    const base: Prisma.AttendanceCorrectionWhereInput = {
      companyId: actor.companyId,
      status: 'PENDING_APPROVAL',
      deletedAt: null,
    };
    // Supervisor scope: only requests from their direct reports.
    if (actor.role === 'SUPERVISOR') {
      base.user = { supervisorId: actor.id };
    }
    return this.prisma.attendanceCorrection.findMany({
      where: base,
      orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  /**
   * Enrich rows for DTO output — attaches the requester's `fullName`.
   * Kept separate from the query methods so callers can decide whether
   * they want the (bounded) extra `User` fetch. `/mine` skips it (self is
   * already known); the approval queue needs it.
   */
  async hydrate(
    rows: AttendanceCorrection[],
    opts: { includeRequester?: boolean } = {},
  ): Promise<HydratedCorrection[]> {
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
    return rows.map((r) => ({ request: r, userFullName: names?.get(r.userId) }));
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------
  private assertPayrollNotLocked(
    actor: AuthenticatedUser,
    targetDate: Date,
    payrollLockedUntil: Date | null | undefined,
  ): void {
    try {
      assertPayrollNotLocked(targetDate, payrollLockedUntil, {
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
   * Execute the plan returned by `planCorrectionApply` inside the caller's
   * transaction. Conflicts are translated to 409; NO_OP / CREATE / PATCH
   * write directly to `AttendanceRecord`.
   */
  private async executeApplyAction(
    tx: Prisma.TransactionClient,
    correction: AttendanceCorrection,
    action: ApplyCorrectionAction,
  ): Promise<void> {
    switch (action.kind) {
      case 'CONFLICT':
        throw new ConflictException(action.code);
      case 'NO_OP':
        this.logger.debug(`correction ${correction.id} apply=NO_OP (idempotent replay)`);
        return;
      case 'CREATE': {
        // Determine which shift applied to (userId, workDate). Preferring
        // the assignment that was in force ON that date, not "today".
        // If no assignment exists, we fall back to the "any assignment"
        // heuristic (latest one) — better than throwing, since HR can
        // fix the shift after-the-fact if needed.
        const assignment = await tx.userShiftAssignment.findFirst({
          where: {
            userId: correction.userId,
            deletedAt: null,
            effectiveFrom: { lte: correction.workDate },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: correction.workDate } }],
          },
          orderBy: { effectiveFrom: 'desc' },
          select: { shiftId: true },
        });
        const fallback = assignment
          ? assignment
          : await tx.userShiftAssignment.findFirst({
              where: { userId: correction.userId, deletedAt: null },
              orderBy: { effectiveFrom: 'desc' },
              select: { shiftId: true },
            });
        if (!fallback) {
          // No shift = we cannot construct a valid AttendanceRecord.
          // Surface the specific reason so HR can assign a shift and retry.
          throw new ConflictException('NO_SHIFT_ASSIGNMENT');
        }
        // Sentinel geo values. `clockInAccuracyM = 0` is our documented
        // marker for "this row was created via correction, not via a
        // real clock-in event". Reports that care about geofence quality
        // can filter these out; payroll doesn't care because payroll only
        // reads clock-in/out times and status.
        await tx.attendanceRecord.create({
          data: {
            companyId: correction.companyId,
            userId: correction.userId,
            shiftId: fallback.shiftId,
            workDate: correction.workDate,
            clockInAt: action.clockInAt!,
            clockOutAt: action.clockOutAt,
            clockInLatitude: new PrismaNs.Decimal(0),
            clockInLongitude: new PrismaNs.Decimal(0),
            clockInAccuracyM: 0,
            clockOutLatitude: action.clockOutAt ? new PrismaNs.Decimal(0) : null,
            clockOutLongitude: action.clockOutAt ? new PrismaNs.Decimal(0) : null,
            clockOutAccuracyM: action.clockOutAt ? 0 : null,
            note: `[correction ${correction.id}]`,
          },
        });
        // Also delete any AbsenceRecord for the same day — the correction
        // just proved the employee WAS present.
        await tx.absenceRecord.deleteMany({
          where: {
            userId: correction.userId,
            workDate: correction.workDate,
          },
        });
        return;
      }
      case 'PATCH': {
        const data: Prisma.AttendanceRecordUpdateInput = {};
        if (action.setClockInAt) data.clockInAt = action.setClockInAt;
        if (action.setClockOutAt) {
          data.clockOutAt = action.setClockOutAt;
          // Fill sentinel geo iff missing — never overwrite a real GPS
          // fix produced by a legitimate clock-out.
          data.clockOutLatitude = new PrismaNs.Decimal(0);
          data.clockOutLongitude = new PrismaNs.Decimal(0);
          data.clockOutAccuracyM = 0;
        }
        if (action.restoreSoftDeleted) data.deletedAt = null;
        await tx.attendanceRecord.update({
          where: { id: action.recordId },
          data,
        });
        return;
      }
    }
  }

  /**
   * Resolve a signed GET URL for the correction's attachment, if any.
   * Same pattern as LeaveService.toRequestDto — regenerate short-lived
   * URLs on every read so leaked links time out quickly.
   */
  async presignAttachmentUrl(key: string | null): Promise<string | null> {
    if (!key) return null;
    try {
      const signed = await this.attachments.presignGet(key);
      return signed.url;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function parseCalendarDateUtc(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const parts = iso.split('-').map(Number);
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

function summarizeRequestedTimes(clockInAt: Date | null, clockOutAt: Date | null): string {
  const fmt = (d: Date): string =>
    `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  const parts: string[] = [];
  if (clockInAt) parts.push(`in ${fmt(clockInAt)}`);
  if (clockOutAt) parts.push(`out ${fmt(clockOutAt)}`);
  return parts.join(', ');
}
