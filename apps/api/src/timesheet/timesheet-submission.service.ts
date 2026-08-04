import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TimesheetStatus } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  timesheetApprovedByHr,
  timesheetApprovedBySupervisor,
  timesheetRejected,
  timesheetReopened,
  timesheetSubmitted,
  type TimesheetEventInput,
} from '../notification/domain/templates';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatcher } from '../webhook/webhook-dispatcher.service';
import { validateReopen } from './domain/reopen-validation';
import {
  ForbiddenTimesheetTransitionError,
  IllegalTimesheetTransitionError,
  transition,
  type WorkflowAction,
} from './domain/submission-workflow';

export type DecideAction = 'SUPERVISOR_APPROVE' | 'SUPERVISOR_REJECT' | 'HR_APPROVE' | 'HR_REJECT';

export interface DecideInput {
  action: DecideAction;
  note?: string | null;
}

/**
 * Workflow transitions for `Timesheet` (Fase 32b). Reads never live
 * here — those stay in `TimesheetService`. This service owns writes
 * that move the status column.
 *
 * Every mutation runs in a single Prisma transaction that also emits
 * an `AuditLog` and a `Notification` — so a partial success is
 * impossible.
 */
@Injectable()
export class TimesheetSubmissionService {
  private readonly logger = new Logger(TimesheetSubmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly webhookDispatcher: WebhookDispatcher,
  ) {}

  /**
   * Employee submits their own timesheet. Legal from DRAFT or
   * REJECTED (re-submit after correction).
   *
   * Extra gates on top of the state machine:
   *   - `periodEnd <= today` — no submitting a mid-period timesheet.
   *   - Owner-only (enforced in the state machine via `actorIsOwner`).
   *   - Supervisor is snapshotted at submit time (from
   *     `User.supervisorId`) so a later re-assignment doesn't yank
   *     the current queue entry.
   */
  async submit(actor: AuthenticatedUser, timesheetId: string): Promise<void> {
    const ts = await this.prisma.timesheet.findFirst({
      where: { id: timesheetId, companyId: actor.companyId },
      include: {
        period: true,
        user: {
          select: {
            id: true,
            supervisorId: true,
            fullName: true,
            email: true,
          },
        },
      },
    });
    if (!ts) throw new NotFoundException('TIMESHEET_NOT_FOUND');

    const nextStatus = this.applyTransition(ts.status, {
      kind: 'SUBMIT',
      actorIsOwner: ts.userId === actor.id,
    });

    const todayUtc = startOfUtcDay(new Date());
    if (ts.period.periodEnd.getTime() > todayUtc.getTime()) {
      throw new ConflictException({
        statusCode: 409,
        code: 'TIMESHEET_PERIOD_NOT_ENDED',
        message: 'Timesheet hanya bisa disubmit setelah periode berakhir.',
      });
    }

    const supervisorId = ts.user.supervisorId;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.timesheet.update({
        where: { id: timesheetId },
        data: {
          status: nextStatus,
          submittedAt: new Date(),
          supervisorId,
          // Clear stale rejection detail so the queue view doesn't
          // show a "was rejected" hint on a freshly-resubmitted row.
          rejectedById: null,
          rejectedAt: null,
          rejectionReason: null,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'TIMESHEET_SUBMITTED',
          entityType: 'Timesheet',
          entityId: timesheetId,
          beforeJson: {
            status: ts.status,
          } as Prisma.InputJsonValue,
          afterJson: {
            status: updated.status,
            supervisorId,
          } as Prisma.InputJsonValue,
        },
      });

      if (supervisorId) {
        const supervisor = await tx.user.findUnique({
          where: { id: supervisorId },
          select: { id: true, email: true },
        });
        if (supervisor) {
          await this.notifications.createOne(
            {
              companyId: actor.companyId,
              recipientId: supervisor.id,
              recipientEmail: supervisor.email,
              content: timesheetSubmitted(this.buildEventInput(ts, actor.email)),
            },
            tx,
          );
        }
      }
    });
  }

  /**
   * Supervisor / HR decide on a submitted timesheet. Guards:
   *   - state machine picks the target status (or throws 409).
   *   - HR-tier actions require HR or SUPER_ADMIN.
   *   - Supervisor-tier actions require the caller to be the
   *     timesheet owner's direct supervisor OR HR/SUPER_ADMIN.
   *
   * Rejections wipe the supervisor / HR decision columns so the next
   * SUBMIT starts clean.
   */
  async decide(actor: AuthenticatedUser, timesheetId: string, input: DecideInput): Promise<void> {
    const ts = await this.prisma.timesheet.findFirst({
      where: { id: timesheetId, companyId: actor.companyId },
      include: {
        period: true,
        user: {
          select: {
            id: true,
            supervisorId: true,
            fullName: true,
            email: true,
          },
        },
      },
    });
    if (!ts) throw new NotFoundException('TIMESHEET_NOT_FOUND');

    const isTeamSupervisor = ts.user.supervisorId === actor.id;

    let workflow: WorkflowAction;
    switch (input.action) {
      case 'SUPERVISOR_APPROVE':
        workflow = {
          kind: 'SUPERVISOR_APPROVE',
          actorRole: actor.role,
          isTeamSupervisor,
        };
        break;
      case 'SUPERVISOR_REJECT':
        workflow = {
          kind: 'SUPERVISOR_REJECT',
          actorRole: actor.role,
          isTeamSupervisor,
        };
        break;
      case 'HR_APPROVE':
        workflow = { kind: 'HR_APPROVE', actorRole: actor.role };
        break;
      case 'HR_REJECT':
        workflow = { kind: 'HR_REJECT', actorRole: actor.role };
        break;
      default: {
        const exhaustive: never = input.action;
        throw new Error(`unhandled decide action: ${String(exhaustive)}`);
      }
    }

    const nextStatus = this.applyTransition(ts.status, workflow);

    const isReject = input.action === 'SUPERVISOR_REJECT' || input.action === 'HR_REJECT';
    if (isReject && !input.note?.trim()) {
      throw new ConflictException({
        statusCode: 409,
        code: 'TIMESHEET_REJECT_NOTE_REQUIRED',
        message:
          'Alasan wajib diisi saat menolak timesheet agar karyawan tahu apa yang perlu dikoreksi.',
      });
    }

    const now = new Date();
    const noteTrimmed = input.note?.trim() || null;

    await this.prisma.$transaction(async (tx) => {
      const patch = this.buildDecisionPatch(input.action, {
        actorId: actor.id,
        note: noteTrimmed,
        now,
      });
      const updated = await tx.timesheet.update({
        where: { id: timesheetId },
        data: {
          status: nextStatus,
          ...patch,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: auditActionFor(input.action),
          entityType: 'Timesheet',
          entityId: timesheetId,
          beforeJson: { status: ts.status } as Prisma.InputJsonValue,
          afterJson: {
            status: updated.status,
            note: noteTrimmed,
          } as Prisma.InputJsonValue,
        },
      });

      const decider = await tx.user.findUnique({
        where: { id: actor.id },
        select: { fullName: true },
      });
      const evt = this.buildEventInput(ts, actor.email);
      evt.decidedByName = decider?.fullName ?? actor.email;
      evt.note = noteTrimmed;

      let content: ReturnType<typeof timesheetSubmitted>;
      switch (input.action) {
        case 'SUPERVISOR_APPROVE':
          content = timesheetApprovedBySupervisor(evt);
          break;
        case 'HR_APPROVE':
          content = timesheetApprovedByHr(evt);
          break;
        case 'SUPERVISOR_REJECT':
        case 'HR_REJECT':
          content = timesheetRejected(evt);
          break;
      }

      // Route the notification:
      //   SUPERVISOR_APPROVE  → user (progress) + HR fanout via
      //                          existing HR mailbox subscribers.
      //                          We DM the user here; HR uses the
      //                          queue view.
      //   Everything else     → user only.
      await this.notifications.createOne(
        {
          companyId: actor.companyId,
          recipientId: ts.userId,
          recipientEmail: ts.user.email,
          content,
        },
        tx,
      );
    });
  }

  /**
   * Fase 32g — HR / Super Admin unlock an already-APPROVED timesheet
   * so the payroll cycle can be corrected. Semantics:
   *
   *   - Only APPROVED rows can be reopened; the state machine's
   *     other statuses are already mutable.
   *   - Reason is mandatory (10..500 chars) — recorded on the row's
   *     `lastReopenReason` denorm AND in the AuditLog for immutable
   *     history.
   *   - Row is reset to `DRAFT`, wiping supervisor / HR decision
   *     metadata so the next submit walks the full chain again.
   *     Employees see the reopen, review, and re-submit → SUPERVISOR
   *     → HR. HR can fast-track by immediately approving both
   *     stages once the employee re-submits.
   *   - `reopenCount` is bumped; `lastReopened*` denorm captures the
   *     latest event for the queue-view badge.
   *   - Notification fanout: owner + supervisor. HR themselves
   *     initiated the action so no HR notification.
   *   - Webhook `TIMESHEET_REOPENED` is enqueued outside the tx
   *     (via WebhookDispatcher) so a slow HTTP push can't stall the
   *     status update.
   *   - Timesheet entries themselves are NOT regenerated — the
   *     reopen is purely a status action. If entry data needs to
   *     change, the operator raises an `AttendanceCorrection` which
   *     triggers its own regenerate path.
   */
  async reopen(
    actor: AuthenticatedUser,
    timesheetId: string,
    reasonRaw: string,
  ): Promise<{
    id: string;
    status: TimesheetStatus;
    reopenCount: number;
  }> {
    const ts = await this.prisma.timesheet.findFirst({
      where: { id: timesheetId, companyId: actor.companyId },
      include: {
        period: true,
        user: {
          select: {
            id: true,
            supervisorId: true,
            fullName: true,
            email: true,
          },
        },
      },
    });
    if (!ts) throw new NotFoundException('TIMESHEET_NOT_FOUND');

    const decision = validateReopen({
      actorRole: actor.role,
      currentStatus: ts.status,
      reasonRaw,
    });
    if (!decision.ok) {
      // Map domain issues → HTTP exceptions with codes the FE can
      // localise. FORBIDDEN_ROLE is 403; every other issue is a 400.
      if (decision.issues.includes('FORBIDDEN_ROLE')) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'TIMESHEET_REOPEN_FORBIDDEN',
          message: 'Hanya HR Manager atau Super Admin yang dapat membuka kembali timesheet.',
        });
      }
      if (decision.issues.includes('STATUS_NOT_APPROVED')) {
        throw new ConflictException({
          statusCode: 409,
          code: 'TIMESHEET_REOPEN_STATUS_INVALID',
          message: `Hanya timesheet berstatus APPROVED yang bisa dibuka kembali (saat ini ${ts.status}).`,
        });
      }
      throw new BadRequestException({
        statusCode: 400,
        code: 'TIMESHEET_REOPEN_REASON_INVALID',
        message: 'Alasan reopen wajib diisi 10..500 karakter.',
        details: decision.issues,
      });
    }
    const reason = decision.reason as string;

    const now = new Date();
    const nextReopenCount = ts.reopenCount + 1;
    const beforeSnapshot = {
      status: ts.status,
      supervisorId: ts.supervisorId,
      supervisorAt: ts.supervisorAt?.toISOString() ?? null,
      hrManagerId: ts.hrManagerId,
      hrManagerAt: ts.hrManagerAt?.toISOString() ?? null,
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.timesheet.update({
        where: { id: timesheetId },
        data: {
          status: 'DRAFT',
          submittedAt: null,
          // Wipe both supervisor + HR decision metadata. The next
          // SUBMIT snapshot supervisor again — losing the old
          // `supervisorId` FK isn't an audit problem because the
          // AuditLog `beforeJson` above preserves it.
          supervisorId: null,
          supervisorAt: null,
          supervisorNote: null,
          hrManagerId: null,
          hrManagerAt: null,
          hrManagerNote: null,
          // Clear any lingering reject state for the same reason as
          // `submit()` — the row is now cleanly DRAFT.
          rejectedById: null,
          rejectedAt: null,
          rejectionReason: null,
          reopenCount: nextReopenCount,
          lastReopenedAt: now,
          lastReopenedById: actor.id,
          lastReopenReason: reason,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'TIMESHEET_REOPENED',
          entityType: 'Timesheet',
          entityId: timesheetId,
          beforeJson: beforeSnapshot as unknown as Prisma.InputJsonValue,
          afterJson: {
            status: 'DRAFT',
            reason,
            reopenCount: nextReopenCount,
          } as Prisma.InputJsonValue,
        },
      });

      // Fetch actor's display name for the notification body. This
      // stays inside the tx so a mid-flight rename can't produce a
      // notification with a stale name paired with a fresh audit row.
      const actorRow = await tx.user.findUnique({
        where: { id: actor.id },
        select: { fullName: true },
      });
      const reopenedByName = actorRow?.fullName ?? actor.email;

      // Notify the owner. Their timesheet was retroactively unlocked;
      // they need to see this even if they've silenced other
      // TIMESHEET_* types (the preference gate is honoured by
      // NotificationService as always).
      await this.notifications.createOne(
        {
          companyId: actor.companyId,
          recipientId: ts.userId,
          recipientEmail: ts.user.email,
          content: timesheetReopened({
            timesheetId: ts.id,
            periodLabel: ts.period.label,
            periodStart: ts.period.periodStart.toISOString().slice(0, 10),
            periodEnd: ts.period.periodEnd.toISOString().slice(0, 10),
            reopenedByName,
            reason,
            audience: 'OWNER',
            reopenCount: nextReopenCount,
          }),
        },
        tx,
      );

      // Notify the direct supervisor so they know a re-submit is coming.
      if (ts.user.supervisorId && ts.user.supervisorId !== actor.id) {
        const supervisor = await tx.user.findUnique({
          where: { id: ts.user.supervisorId },
          select: { id: true, email: true },
        });
        if (supervisor) {
          await this.notifications.createOne(
            {
              companyId: actor.companyId,
              recipientId: supervisor.id,
              recipientEmail: supervisor.email,
              content: timesheetReopened({
                timesheetId: ts.id,
                periodLabel: ts.period.label,
                periodStart: ts.period.periodStart.toISOString().slice(0, 10),
                periodEnd: ts.period.periodEnd.toISOString().slice(0, 10),
                reopenedByName,
                reason,
                audience: 'SUPERVISOR',
                reopenCount: nextReopenCount,
              }),
            },
            tx,
          );
        }
      }
    });

    // Webhook enqueue AFTER commit — a rollback should not leak an
    // outbound push. WebhookDispatcher persists the delivery row on
    // the main connection, and the worker picks it up asynchronously.
    await this.webhookDispatcher.enqueue({
      companyId: actor.companyId,
      eventType: 'TIMESHEET_REOPENED',
      sourceId: `reopen_${timesheetId}_${nextReopenCount}`,
      data: {
        timesheetId,
        userId: ts.userId,
        periodId: ts.periodId,
        periodLabel: ts.period.label,
        periodStart: ts.period.periodStart.toISOString().slice(0, 10),
        periodEnd: ts.period.periodEnd.toISOString().slice(0, 10),
        reopenCount: nextReopenCount,
        reopenedAt: now.toISOString(),
        reopenedBy: {
          id: actor.id,
          email: actor.email,
        },
        reason,
      },
    });

    return {
      id: timesheetId,
      status: 'DRAFT',
      reopenCount: nextReopenCount,
    };
  }

  private applyTransition(from: TimesheetStatus, action: WorkflowAction): TimesheetStatus {
    try {
      return transition(from, action);
    } catch (err) {
      if (err instanceof ForbiddenTimesheetTransitionError) {
        throw new ForbiddenException({
          statusCode: 403,
          code: err.code,
          message: 'Tindakan ini tidak diperbolehkan untuk peran Anda pada timesheet tersebut.',
        });
      }
      if (err instanceof IllegalTimesheetTransitionError) {
        throw new ConflictException({
          statusCode: 409,
          code: err.code,
          message: `Timesheet dalam status ${err.from} tidak dapat menjalani ${err.to}.`,
        });
      }
      throw err;
    }
  }

  private buildDecisionPatch(
    action: DecideAction,
    ctx: { actorId: string; note: string | null; now: Date },
  ): Prisma.TimesheetUpdateInput {
    switch (action) {
      case 'SUPERVISOR_APPROVE':
        return {
          supervisor: { connect: { id: ctx.actorId } },
          supervisorAt: ctx.now,
          supervisorNote: ctx.note,
        };
      case 'HR_APPROVE':
        return {
          hrManager: { connect: { id: ctx.actorId } },
          hrManagerAt: ctx.now,
          hrManagerNote: ctx.note,
        };
      case 'SUPERVISOR_REJECT':
      case 'HR_REJECT':
        return {
          rejectedBy: { connect: { id: ctx.actorId } },
          rejectedAt: ctx.now,
          rejectionReason: ctx.note,
        };
    }
  }

  private buildEventInput(
    ts: {
      id: string;
      period: { label: string; periodStart: Date; periodEnd: Date };
      user: { fullName: string };
    },
    actorEmail: string,
  ): TimesheetEventInput {
    return {
      timesheetId: ts.id,
      requesterName: ts.user.fullName ?? actorEmail,
      periodLabel: ts.period.label,
      periodStart: ts.period.periodStart.toISOString().slice(0, 10),
      periodEnd: ts.period.periodEnd.toISOString().slice(0, 10),
    };
  }
}

function auditActionFor(action: DecideAction): string {
  switch (action) {
    case 'SUPERVISOR_APPROVE':
      return 'TIMESHEET_SUPERVISOR_APPROVED';
    case 'SUPERVISOR_REJECT':
      return 'TIMESHEET_SUPERVISOR_REJECTED';
    case 'HR_APPROVE':
      return 'TIMESHEET_HR_APPROVED';
    case 'HR_REJECT':
      return 'TIMESHEET_HR_REJECTED';
  }
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
