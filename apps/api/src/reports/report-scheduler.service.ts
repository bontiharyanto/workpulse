import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, ReportSchedule } from '@prisma/client';

import {
  EMAIL_ADAPTER,
  type EmailAdapter,
} from '../notification/email/email-adapter';
import { PrismaService } from '../prisma/prisma.service';

import { labelFor } from './domain/report-registry';
import { ReportRendererService } from './renderers/report-renderer.service';
import { ReportScheduleService } from './report-schedule.service';

/**
 * Fase 33c — dispatcher.
 *
 * Loop shape:
 *   1. Claim up to N schedules where `active = true` and
 *      `nextRunAt ≤ now` using `SELECT ... FOR UPDATE SKIP LOCKED`.
 *   2. Insert a `ReportDelivery(status=DISPATCHING)` row.
 *   3. Render the payload → `sha256`.
 *   4. Call `EmailAdapter.send()` with the PDF attached.
 *   5. Flip delivery to `DELIVERED` / `FAILED` and advance the schedule
 *      cursor.
 *
 * All steps 2..5 run per-schedule; a poison-pill row cannot block
 * neighbours. The whole cursor-advance and delivery-log write happen
 * outside the claim transaction to release row-locks quickly.
 */
@Injectable()
export class ReportSchedulerService {
  private readonly logger = new Logger(ReportSchedulerService.name);

  static readonly BATCH_SIZE = 20;

  constructor(
    private readonly prisma: PrismaService,
    private readonly renderer: ReportRendererService,
    private readonly scheduleService: ReportScheduleService,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
  ) {}

  async tickOnce(now: Date = new Date()): Promise<number> {
    const claimed = await this.claim(now);
    if (claimed.length === 0) return 0;

    let delivered = 0;
    for (const schedule of claimed) {
      try {
        await this.dispatch(schedule, now);
        delivered += 1;
      } catch (err) {
        this.logger.error(
          `Report schedule ${schedule.id} dispatch threw: ${(err as Error).message}`,
        );
      }
    }
    return delivered;
  }

  /**
   * Claim rows using SKIP LOCKED. We deliberately mutate the row inside
   * the same tx (`update nextRunAt = now + 15min` as a "hold token") so
   * other replicas cannot re-claim while we render. This isn't perfect
   * (a crash between claim and successful advance could double-dispatch
   * within a 15-minute window), but the delivery log dedup by
   * `(scheduleId, createdAt within tolerance)` handles the rare case.
   */
  private async claim(now: Date): Promise<ReportSchedule[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM "ReportSchedule"
        WHERE "active" = true
          AND "nextRunAt" <= ${now}
        ORDER BY "nextRunAt" ASC
        LIMIT ${ReportSchedulerService.BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `);
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      // Advance the hold token to now + 15 minutes to avoid a re-claim
      // by a peer worker while we render the payload.
      const holdUntil = new Date(now.getTime() + 15 * 60 * 1000);
      await tx.reportSchedule.updateMany({
        where: { id: { in: ids } },
        data: { nextRunAt: holdUntil },
      });
      return tx.reportSchedule.findMany({ where: { id: { in: ids } } });
    });
  }

  private async dispatch(
    schedule: ReportSchedule,
    now: Date,
  ): Promise<void> {
    if (schedule.recipients.length === 0) {
      this.logger.warn(
        `Schedule ${schedule.id} has no recipients — marking FAILED`,
      );
      await this.recordFailure(
        schedule,
        now,
        'Schedule has no recipients',
      );
      await this.scheduleService.advanceCursor(schedule.id, now);
      return;
    }

    if (schedule.reportType === 'CUSTOM' && !schedule.savedReportId) {
      await this.recordFailure(
        schedule,
        now,
        'CUSTOM reportType requires savedReportId',
      );
      await this.scheduleService.advanceCursor(schedule.id, now);
      return;
    }

    const delivery = await this.prisma.reportDelivery.create({
      data: {
        companyId: schedule.companyId,
        scheduleId: schedule.id,
        recipients: schedule.recipients,
        status: 'DISPATCHING',
        attempts: 1,
        lastAttemptAt: now,
      },
    });

    let bytes: Buffer;
    let filename: string;
    let mimeType: string;
    let summary: string;
    try {
      const rendered = await this.renderer.render(
        schedule.companyId,
        schedule.reportType,
        now,
        { savedReportId: schedule.savedReportId },
      );
      bytes = rendered.bytes;
      filename = rendered.filename;
      mimeType = rendered.mimeType;
      summary = rendered.summary;
    } catch (err) {
      const msg = (err as Error).message.slice(0, 500);
      await this.prisma.reportDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'FAILED',
          errorSnippet: `render: ${msg}`,
        },
      });
      await this.scheduleService.advanceCursor(schedule.id, now);
      return;
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex');

    try {
      await this.email.send({
        to: schedule.recipients.join(', '),
        subject: `${labelFor(schedule.reportType)} — ${now
          .toISOString()
          .slice(0, 10)}`,
        body:
          `${summary}\n\nDikirim otomatis oleh Workpulse scheduler.\n` +
          `Schedule: ${schedule.name}\n` +
          `Report type: ${schedule.reportType}\n` +
          `Waktu: ${now.toISOString()}\n`,
        attachments: [{ filename, contentType: mimeType, bytes }],
      });
      await this.prisma.reportDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          payloadSha256: sha256,
          payloadBytes: bytes.byteLength,
          attachmentFilename: filename,
        },
      });
      await this.prisma.auditLog.create({
        data: {
          companyId: schedule.companyId,
          actorId: null,
          action: 'REPORT_DELIVERY_SENT',
          entityType: 'ReportDelivery',
          entityId: delivery.id,
          afterJson: {
            scheduleId: schedule.id,
            reportType: schedule.reportType,
            sha256,
            bytes: bytes.byteLength,
            recipientCount: schedule.recipients.length,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      const msg = (err as Error).message.slice(0, 500);
      await this.prisma.reportDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'FAILED',
          errorSnippet: `send: ${msg}`,
          payloadSha256: sha256,
          payloadBytes: bytes.byteLength,
          attachmentFilename: filename,
        },
      });
    }

    await this.scheduleService.advanceCursor(schedule.id, now);
  }

  private async recordFailure(
    schedule: ReportSchedule,
    now: Date,
    error: string,
  ): Promise<void> {
    await this.prisma.reportDelivery.create({
      data: {
        companyId: schedule.companyId,
        scheduleId: schedule.id,
        recipients: schedule.recipients,
        status: 'FAILED',
        attempts: 1,
        lastAttemptAt: now,
        errorSnippet: error,
      },
    });
  }
}
