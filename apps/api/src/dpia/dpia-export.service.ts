import { createHash } from 'node:crypto';

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import { renderDpiaPdf } from './renderers/dpia-pdf-renderer';

export interface DpiaExportResult {
  filename: string;
  contentType: 'application/pdf';
  bytes: Buffer;
  sha256: string;
}

/**
 * Fase 31e — DPIA export orchestrator.
 *
 * Follows the "audit-before-stream" pattern that the timesheet + ROPA
 * exports established:
 *   1. Buffer the entire PDF in memory.
 *   2. Compute SHA-256 of the buffer.
 *   3. Write a `DPIA_EXPORTED` audit row atomically with the hash.
 *   4. Only THEN return the bytes to the controller for streaming.
 *
 * If step 3 fails (DB down, tx aborted), the caller never receives a
 * byte — no compliance leak without a paper trail.
 */
@Injectable()
export class DpiaExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportPdf(
    actor: AuthenticatedUser,
    assessmentId: string,
    now: Date = new Date(),
  ): Promise<DpiaExportResult> {
    const assessment = await this.prisma.dpiaAssessment.findFirst({
      where: { id: assessmentId, companyId: actor.companyId },
      include: {
        riskItems: { orderBy: { ordinal: 'asc' } },
        ropaActivity: {
          select: {
            slug: true,
            currentVersion: { select: { name: true } },
          },
        },
      },
    });
    if (!assessment) throw new NotFoundException('DPIA_NOT_FOUND');

    const company = await this.prisma.company.findUnique({
      where: { id: actor.companyId },
      select: { name: true },
    });

    const bytes = await renderDpiaPdf(
      {
        companyName: company?.name ?? '(unknown)',
        generatedAt: now,
        ropaActivitySlug: assessment.ropaActivity.slug,
        ropaActivityName:
          assessment.ropaActivity.currentVersion?.name ?? assessment.ropaActivity.slug,
      },
      assessment,
    );

    const sha256 = createHash('sha256').update(bytes).digest('hex');

    await this.prisma.auditLog.create({
      data: {
        companyId: actor.companyId,
        actorId: actor.id,
        action: 'DPIA_EXPORTED',
        entityType: 'DpiaAssessment',
        entityId: assessment.id,
        afterJson: {
          sha256,
          format: 'pdf',
          byteLength: bytes.byteLength,
          status: assessment.status,
        } as Prisma.InputJsonValue,
      },
    });

    const safeSlug = assessment.ropaActivity.slug.replace(/[^a-z0-9-]/gi, '-');
    return {
      filename: `dpia-${safeSlug}-${assessment.id}.pdf`,
      contentType: 'application/pdf',
      bytes,
      sha256,
    };
  }
}
