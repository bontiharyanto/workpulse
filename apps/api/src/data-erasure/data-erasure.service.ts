import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DataErasureRequest, Prisma } from '@prisma/client';
import { DataErasureStatus } from '@prisma/client';

import { NotificationService } from '../notification/notification.service';
import {
  dataErasureApproved,
  dataErasureRejected,
  dataErasureRequested,
} from '../notification/domain/templates';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../storage/storage.provider';

/**
 * Right-to-erasure service (Fase 31b). The state machine looks like:
 *
 *   PENDING_APPROVAL ──(approve)──► APPROVED_SCHEDULED
 *      │                                    │
 *      │(reject)                            │(cancel by user)
 *      ▼                                    ▼
 *   REJECTED                             CANCELLED
 *                                           │
 *                                           │(worker after `scheduledFor`)
 *                                           ▼
 *                                        EXECUTED (or FAILED on error)
 *
 * The service enforces:
 *
 *   * only HR_MANAGER or SUPER_ADMIN can approve / reject
 *   * only the target user can cancel (before execution)
 *   * only one active request at a time per user
 *
 * The worker is separate (`DataErasureWorker`) and picks up
 * `APPROVED_SCHEDULED` rows whose `scheduledFor` has elapsed.
 */
@Injectable()
export class DataErasureService {
  private readonly logger = new Logger(DataErasureService.name);
  private readonly graceDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    config: ConfigService,
  ) {
    this.graceDays = Number(config.get<string>('DATA_ERASURE_GRACE_DAYS', '7'));
  }

  // -------------------------------------------------------------------------
  // User-side
  // -------------------------------------------------------------------------

  async create(userId: string, companyId: string, reason?: string): Promise<DataErasureRequest> {
    // Reject if any active request exists.
    const active = await this.prisma.dataErasureRequest.findFirst({
      where: {
        userId,
        status: {
          in: [DataErasureStatus.PENDING_APPROVAL, DataErasureStatus.APPROVED_SCHEDULED],
        },
      },
    });
    if (active) {
      throw new ConflictException({
        statusCode: 409,
        code: 'ERASURE_ALREADY_PENDING',
        message:
          'Permintaan penghapusan data Anda sedang diproses. Batalkan terlebih dahulu bila ingin mengubahnya.',
        details: { requestId: active.id, status: active.status },
      });
    }

    const requester = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true, deletedAt: true },
    });
    if (!requester || requester.deletedAt !== null) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'User tidak ditemukan.',
      });
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dataErasureRequest.create({
        data: {
          userId,
          companyId,
          reason: reason?.slice(0, 1000) ?? null,
          status: DataErasureStatus.PENDING_APPROVAL,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId,
          actorId: userId,
          action: 'DATA_ERASURE_REQUESTED',
          entityType: 'DataErasureRequest',
          entityId: created.id,
          afterJson: reason
            ? ({ reason: reason.slice(0, 500) } as Prisma.InputJsonValue)
            : undefined,
        },
      });
      return created;
    });

    // Notify HR / admins OUTSIDE the transaction — email delivery is
    // slow and would extend the tx unnecessarily. Failure is logged
    // but does not roll back the request.
    await this.notifyDecisionMakers(companyId, {
      requestId: row.id,
      requesterName: requester.fullName,
    }).catch((err: Error) =>
      this.logger.warn(`notifyDecisionMakers failed for erasure ${row.id}: ${err.message}`),
    );

    return row;
  }

  async list(userId: string): Promise<DataErasureRequest[]> {
    return this.prisma.dataErasureRequest.findMany({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
      take: 25,
    });
  }

  async cancel(userId: string, requestId: string): Promise<DataErasureRequest> {
    const row = await this.prisma.dataErasureRequest.findUnique({
      where: { id: requestId },
    });
    if (!row || row.userId !== userId) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'ERASURE_NOT_FOUND',
        message: 'Permintaan penghapusan tidak ditemukan.',
      });
    }
    // Only these two states are cancellable. Once EXECUTED there's
    // nothing to un-do; REJECTED / CANCELLED / FAILED are terminal.
    if (
      row.status !== DataErasureStatus.PENDING_APPROVAL &&
      row.status !== DataErasureStatus.APPROVED_SCHEDULED
    ) {
      throw new ConflictException({
        statusCode: 409,
        code: 'ERASURE_NOT_CANCELLABLE',
        message: `Permintaan dengan status ${row.status} tidak dapat dibatalkan.`,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.dataErasureRequest.update({
        where: { id: row.id },
        data: {
          status: DataErasureStatus.CANCELLED,
          cancelledAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: row.companyId,
          actorId: userId,
          action: 'DATA_ERASURE_CANCELLED',
          entityType: 'DataErasureRequest',
          entityId: row.id,
        },
      });
      return updated;
    });
  }

  // -------------------------------------------------------------------------
  // Admin-side
  // -------------------------------------------------------------------------

  async listPending(companyId: string): Promise<DataErasureRequest[]> {
    return this.prisma.dataErasureRequest.findMany({
      where: {
        companyId,
        status: {
          in: [DataErasureStatus.PENDING_APPROVAL, DataErasureStatus.APPROVED_SCHEDULED],
        },
      },
      orderBy: { requestedAt: 'asc' },
    });
  }

  async listAll(companyId: string): Promise<DataErasureRequest[]> {
    return this.prisma.dataErasureRequest.findMany({
      where: { companyId },
      orderBy: { requestedAt: 'desc' },
      take: 100,
    });
  }

  async approve(
    actor: { id: string; role: string; companyId: string },
    requestId: string,
    note?: string,
  ): Promise<DataErasureRequest> {
    this.assertApproverRole(actor.role);
    const row = await this.loadForDecision(actor.companyId, requestId);
    if (row.status !== DataErasureStatus.PENDING_APPROVAL) {
      throw new ConflictException({
        statusCode: 409,
        code: 'ERASURE_INVALID_TRANSITION',
        message: `Permintaan dengan status ${row.status} tidak bisa disetujui.`,
      });
    }
    if (row.userId === actor.id) {
      // Approver cannot approve their own erasure — that would let a
      // rogue HR_MANAGER erase themselves and their audit trail in
      // one shot. Force a colleague to make the decision.
      throw new ForbiddenException({
        statusCode: 403,
        code: 'ERASURE_SELF_APPROVAL',
        message: 'Anda tidak dapat menyetujui permintaan penghapusan Anda sendiri.',
      });
    }

    const now = new Date();
    const scheduledFor = new Date(now.getTime() + this.graceDays * 86_400_000);

    const [updated, target] = await this.prisma.$transaction(async (tx) => {
      const upd = await tx.dataErasureRequest.update({
        where: { id: row.id },
        data: {
          status: DataErasureStatus.APPROVED_SCHEDULED,
          decidedById: actor.id,
          decidedAt: now,
          decisionNote: note?.slice(0, 1000) ?? null,
          scheduledFor,
        },
      });
      const t = await tx.user.findUnique({
        where: { id: row.userId },
        select: { fullName: true, email: true },
      });
      await tx.auditLog.create({
        data: {
          companyId: row.companyId,
          actorId: actor.id,
          action: 'DATA_ERASURE_APPROVED',
          entityType: 'DataErasureRequest',
          entityId: row.id,
          afterJson: {
            scheduledFor: scheduledFor.toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
      return [upd, t] as const;
    });

    // Notify the requester (email + in-app). Failure is logged.
    if (target?.email) {
      const decider = await this.prisma.user.findUnique({
        where: { id: actor.id },
        select: { fullName: true },
      });
      await this.notifications
        .createOne({
          companyId: row.companyId,
          recipientId: row.userId,
          recipientEmail: target.email,
          content: dataErasureApproved({
            requestId: row.id,
            requesterName: target.fullName,
            scheduledFor: scheduledFor.toISOString(),
            decidedByName: decider?.fullName,
          }),
        })
        .catch((err: Error) =>
          this.logger.warn(`erasure APPROVED notify failed requestId=${row.id}: ${err.message}`),
        );
    }

    return updated;
  }

  async reject(
    actor: { id: string; role: string; companyId: string },
    requestId: string,
    note: string,
  ): Promise<DataErasureRequest> {
    this.assertApproverRole(actor.role);
    if (!note || note.trim().length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'ERASURE_REJECT_NOTE_REQUIRED',
        message: 'Alasan penolakan wajib diisi.',
      });
    }
    const row = await this.loadForDecision(actor.companyId, requestId);
    if (row.status !== DataErasureStatus.PENDING_APPROVAL) {
      throw new ConflictException({
        statusCode: 409,
        code: 'ERASURE_INVALID_TRANSITION',
        message: `Permintaan dengan status ${row.status} tidak bisa ditolak.`,
      });
    }

    const now = new Date();
    const [updated, target] = await this.prisma.$transaction(async (tx) => {
      const upd = await tx.dataErasureRequest.update({
        where: { id: row.id },
        data: {
          status: DataErasureStatus.REJECTED,
          decidedById: actor.id,
          decidedAt: now,
          decisionNote: note.slice(0, 1000),
        },
      });
      const t = await tx.user.findUnique({
        where: { id: row.userId },
        select: { fullName: true, email: true },
      });
      await tx.auditLog.create({
        data: {
          companyId: row.companyId,
          actorId: actor.id,
          action: 'DATA_ERASURE_REJECTED',
          entityType: 'DataErasureRequest',
          entityId: row.id,
          afterJson: { note: note.slice(0, 500) } as Prisma.InputJsonValue,
        },
      });
      return [upd, t] as const;
    });

    if (target?.email) {
      const decider = await this.prisma.user.findUnique({
        where: { id: actor.id },
        select: { fullName: true },
      });
      await this.notifications
        .createOne({
          companyId: row.companyId,
          recipientId: row.userId,
          recipientEmail: target.email,
          content: dataErasureRejected({
            requestId: row.id,
            requesterName: target.fullName,
            decidedByName: decider?.fullName,
            note,
          }),
        })
        .catch((err: Error) =>
          this.logger.warn(`erasure REJECTED notify failed requestId=${row.id}: ${err.message}`),
        );
    }

    return updated;
  }

  // -------------------------------------------------------------------------
  // Helpers exposed for the worker
  // -------------------------------------------------------------------------

  /**
   * Delete out-of-tx S3 objects captured by the anonymiser. Best
   * effort — retention sweeps and manual reconciliation catch the
   * residue. Failure is logged, never thrown.
   */
  async deleteExportedArchives(fileKeys: string[]): Promise<void> {
    for (const key of fileKeys) {
      try {
        await this.storage.deleteObject(key);
      } catch (err) {
        this.logger.warn(`erasure: failed to delete S3 object ${key}: ${(err as Error).message}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private assertApproverRole(role: string): void {
    if (role !== 'HR_MANAGER' && role !== 'SUPER_ADMIN') {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'ERASURE_ROLE_FORBIDDEN',
        message: 'Hanya HR Manager atau Super Admin yang dapat memutuskan.',
      });
    }
  }

  private async loadForDecision(companyId: string, requestId: string): Promise<DataErasureRequest> {
    const row = await this.prisma.dataErasureRequest.findUnique({
      where: { id: requestId },
    });
    // Tenant scoping AND existence check collapsed into a single 404 so
    // an HR from tenant A cannot enumerate erasure IDs of tenant B.
    if (!row || row.companyId !== companyId) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'ERASURE_NOT_FOUND',
        message: 'Permintaan penghapusan tidak ditemukan.',
      });
    }
    return row;
  }

  private async notifyDecisionMakers(
    companyId: string,
    payload: { requestId: string; requesterName: string },
  ): Promise<void> {
    const approvers = await this.prisma.user.findMany({
      where: {
        companyId,
        role: { in: ['HR_MANAGER', 'SUPER_ADMIN'] },
        deletedAt: null,
      },
      select: { id: true, email: true },
    });
    // Fan out sequentially — the list is small (usually < 5 per
    // tenant) and parallelism would concentrate on the SMTP pool.
    for (const approver of approvers) {
      await this.notifications
        .createOne({
          companyId,
          recipientId: approver.id,
          recipientEmail: approver.email,
          content: dataErasureRequested(payload),
        })
        .catch((err: Error) =>
          this.logger.warn(`erasure REQUESTED notify failed for ${approver.id}: ${err.message}`),
        );
    }
  }
}
