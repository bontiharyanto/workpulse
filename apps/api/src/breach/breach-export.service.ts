import { createHash } from 'node:crypto';

import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BreachIncident,
  BreachTimelineEvent,
  BreachTimelineEventType,
  Prisma,
} from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import { renderBreachPdf } from './renderers/breach-pdf-renderer';

export interface BreachExportResult {
  filename: string;
  contentType: 'application/pdf';
  bytes: Buffer;
  sha256: string;
}

type WithTimeline = BreachIncident & {
  timeline: (BreachTimelineEvent & { actor: { email: string } | null })[];
  reportedBy: { email: string } | null;
  assignedTo: { email: string } | null;
};

/**
 * Fase 31g — regulator PDF export orchestrator.
 *
 * Audit-before-stream (same idiom as ROPA / DPIA / Timesheet):
 *
 *   1. Buffer the entire PDF.
 *   2. SHA-256 the payload.
 *   3. Write `BREACH_EXPORTED` audit row + timeline event atomically.
 *   4. Only THEN hand bytes to the controller.
 */
@Injectable()
export class BreachExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportPdf(
    actor: AuthenticatedUser,
    incidentId: string,
    now: Date = new Date(),
  ): Promise<BreachExportResult> {
    const incident = (await this.prisma.breachIncident.findFirst({
      where: { id: incidentId, companyId: actor.companyId },
      include: {
        reportedBy: { select: { email: true } },
        assignedTo: { select: { email: true } },
        timeline: {
          orderBy: { occurredAt: 'asc' },
          include: { actor: { select: { email: true } } },
        },
      },
    })) as WithTimeline | null;
    if (!incident) throw new NotFoundException('BREACH_NOT_FOUND');

    const company = await this.prisma.company.findUnique({
      where: { id: actor.companyId },
      select: { name: true },
    });

    const bytes = await renderBreachPdf(
      {
        companyName: company?.name ?? '(unknown)',
        generatedAt: now,
        generatedByEmail: actor.email,
      },
      incident,
    );

    const sha256 = createHash('sha256').update(bytes).digest('hex');

    await this.prisma.$transaction(async (tx) => {
      await tx.breachTimelineEvent.create({
        data: {
          incidentId: incident.id,
          companyId: actor.companyId,
          eventType: BreachTimelineEventType.EXPORTED,
          note: `Exported regulator PDF (${bytes.byteLength} bytes)`,
          metadata: {
            sha256,
            byteLength: bytes.byteLength,
          } as Prisma.InputJsonValue,
          actorId: actor.id,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'BREACH_EXPORTED',
          entityType: 'BreachIncident',
          entityId: incident.id,
          afterJson: {
            sha256,
            format: 'pdf',
            byteLength: bytes.byteLength,
            status: incident.status,
          } as Prisma.InputJsonValue,
        },
      });
    });

    return {
      filename: `breach-${incident.id}.pdf`,
      contentType: 'application/pdf',
      bytes,
      sha256,
    };
  }
}
