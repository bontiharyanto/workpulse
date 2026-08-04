import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, ReportFrequency, ScheduledReportType } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import { InvalidCadenceError, advance, initialNextRun } from './domain/next-run';

interface CreateInput {
  name: string;
  reportType: ScheduledReportType;
  savedReportId?: string;
  frequency: ReportFrequency;
  cadenceDay?: number;
  cadenceHour: number;
  recipients: string[];
}

interface UpdateInput {
  name?: string;
  frequency?: ReportFrequency;
  cadenceDay?: number | null;
  cadenceHour?: number;
  recipients?: string[];
  active?: boolean;
}

/**
 * Fase 33c — schedule CRUD.
 *
 * `cadenceHour` comes from the caller in **UTC**. The FE picker
 * projects local time into UTC before submitting; the DB stores the
 * UTC-hour so the worker never has to think about tenant timezones
 * again.
 *
 * Every mutation writes an `AuditLog` row inside the same transaction.
 */
@Injectable()
export class ReportScheduleService {
  private readonly logger = new Logger(ReportScheduleService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthenticatedUser) {
    return this.prisma.reportSchedule.findMany({
      where: { companyId: actor.companyId },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  async listDeliveries(actor: AuthenticatedUser, scheduleId: string) {
    const s = await this.prisma.reportSchedule.findFirst({
      where: { id: scheduleId, companyId: actor.companyId },
      select: { id: true },
    });
    if (!s) throw new NotFoundException('SCHEDULE_NOT_FOUND');
    return this.prisma.reportDelivery.findMany({
      where: { scheduleId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async create(actor: AuthenticatedUser, input: CreateInput) {
    return this.prisma.$transaction(async (tx) => {
      let nextRunAt: Date;
      try {
        nextRunAt = initialNextRun(new Date(), {
          frequency: input.frequency,
          cadenceDay: input.cadenceDay ?? null,
          cadenceHourUtc: input.cadenceHour,
        });
      } catch (err) {
        this.rethrowCadence(err);
      }
      if (input.reportType === 'CUSTOM') {
        if (!input.savedReportId) {
          throw new BadRequestException('CUSTOM reportType requires savedReportId');
        }
        const saved = await tx.savedReport.findFirst({
          where: { id: input.savedReportId, companyId: actor.companyId },
          select: { id: true },
        });
        if (!saved) {
          throw new BadRequestException('SAVED_REPORT_NOT_FOUND');
        }
      }
      const created = await tx.reportSchedule.create({
        data: {
          companyId: actor.companyId,
          name: input.name,
          reportType: input.reportType,
          savedReportId: input.reportType === 'CUSTOM' ? (input.savedReportId ?? null) : null,
          frequency: input.frequency,
          cadenceDay: input.cadenceDay ?? null,
          cadenceHour: input.cadenceHour,
          recipients: dedupeEmails(input.recipients),
          nextRunAt,
          createdById: actor.id,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'REPORT_SCHEDULE_CREATED',
          entityType: 'ReportSchedule',
          entityId: created.id,
          afterJson: {
            reportType: created.reportType,
            frequency: created.frequency,
            recipients: created.recipients,
          } as Prisma.InputJsonValue,
        },
      });
      return created;
    });
  }

  async update(actor: AuthenticatedUser, id: string, input: UpdateInput) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.reportSchedule.findFirst({
        where: { id, companyId: actor.companyId },
      });
      if (!current) throw new NotFoundException('SCHEDULE_NOT_FOUND');

      const patch: Prisma.ReportScheduleUncheckedUpdateInput = {};
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.frequency !== undefined) patch.frequency = input.frequency;
      if (input.cadenceDay !== undefined) patch.cadenceDay = input.cadenceDay;
      if (input.cadenceHour !== undefined) patch.cadenceHour = input.cadenceHour;
      if (input.recipients !== undefined) patch.recipients = dedupeEmails(input.recipients);
      if (input.active !== undefined) patch.active = input.active;

      // Any cadence-touching edit reschedules `nextRunAt` forward.
      if (
        input.frequency !== undefined ||
        input.cadenceDay !== undefined ||
        input.cadenceHour !== undefined
      ) {
        const cfg = {
          frequency: (input.frequency ?? current.frequency) as ReportFrequency,
          cadenceDay: input.cadenceDay !== undefined ? input.cadenceDay : current.cadenceDay,
          cadenceHourUtc: input.cadenceHour ?? current.cadenceHour,
        };
        try {
          patch.nextRunAt = initialNextRun(new Date(), cfg);
        } catch (err) {
          this.rethrowCadence(err);
        }
      }

      const updated = await tx.reportSchedule.update({
        where: { id },
        data: patch,
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'REPORT_SCHEDULE_UPDATED',
          entityType: 'ReportSchedule',
          entityId: updated.id,
          afterJson: {
            fields: Object.keys(patch),
          } as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
  }

  async remove(actor: AuthenticatedUser, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.reportSchedule.findFirst({
        where: { id, companyId: actor.companyId },
      });
      if (!current) throw new NotFoundException('SCHEDULE_NOT_FOUND');
      await tx.reportSchedule.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'REPORT_SCHEDULE_DELETED',
          entityType: 'ReportSchedule',
          entityId: id,
          beforeJson: {
            reportType: current.reportType,
            frequency: current.frequency,
          } as Prisma.InputJsonValue,
        },
      });
    });
  }

  /**
   * Post-dispatch cursor advance. Called by the scheduler AFTER a
   * successful delivery (or when the delivery is marked FAILED and the
   * caller decides not to retry immediately).
   */
  async advanceCursor(scheduleId: string, lastRunAt: Date): Promise<void> {
    const s = await this.prisma.reportSchedule.findUnique({
      where: { id: scheduleId },
    });
    if (!s) return;
    try {
      const nextRunAt = advance(lastRunAt, {
        frequency: s.frequency,
        cadenceDay: s.cadenceDay,
        cadenceHourUtc: s.cadenceHour,
      });
      await this.prisma.reportSchedule.update({
        where: { id: s.id },
        data: { nextRunAt, lastRunAt },
      });
    } catch (err) {
      this.logger.warn(`Failed to advance schedule ${scheduleId}: ${(err as Error).message}`);
    }
  }

  private rethrowCadence(err: unknown): never {
    if (err instanceof InvalidCadenceError) {
      throw new BadRequestException(err.message);
    }
    throw err as Error;
  }
}

function dedupeEmails(inputs: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of inputs) {
    const norm = raw.trim().toLowerCase();
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}
