import { createHash } from 'node:crypto';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import type {
  RopaExportHeader,
  RopaExportRow,
} from './renderers/ropa-export-types';
import { renderRopaPdf } from './renderers/ropa-pdf-renderer';
import { renderRopaXlsx } from './renderers/ropa-xlsx-renderer';
import { RopaRegistryService } from './ropa-registry.service';

export type RopaExportFormat = 'PDF' | 'XLSX';

export interface RopaExportResult {
  format: RopaExportFormat;
  filename: string;
  contentType: string;
  bytes: Buffer;
  sha256: string;
  rowCount: number;
}

/**
 * Fase 31d — build a ROPA export (PDF or XLSX) + audit BEFORE returning
 * the bytes to the caller.
 *
 * Why buffer-first-then-audit? Regulators demand a tamper-evident trail:
 * we must be able to say "on 2026-08-03 at 14:22 UTC, user X downloaded a
 * ROPA export whose bytes hash to `sha256:...`". The only way to keep the
 * audit row honest is to compute the hash before we start streaming and
 * to abort the download if the audit insert fails.
 */
@Injectable()
export class RopaExportService {
  private readonly logger = new Logger(RopaExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: RopaRegistryService,
  ) {}

  async buildExport(
    actor: AuthenticatedUser,
    format: RopaExportFormat,
  ): Promise<RopaExportResult> {
    const company = await this.prisma.company.findUnique({
      where: { id: actor.companyId },
      select: { id: true, name: true },
    });
    if (!company) throw new NotFoundException('COMPANY_NOT_FOUND');

    const rowsRaw = await this.registry.listPublishedForExport(company.id);
    const rows: RopaExportRow[] = rowsRaw.map((r) => ({
      ...r,
      slug: r.activity.slug,
    }));

    const header: RopaExportHeader = {
      companyName: company.name,
      generatedAt: new Date(),
      generatedByEmail: actor.email,
    };

    const bytes =
      format === 'PDF'
        ? await renderRopaPdf(header, rows)
        : await renderRopaXlsx(header, rows);

    const sha256 = createHash('sha256').update(bytes).digest('hex');

    // Audit BEFORE returning bytes. If the audit insert throws (DB down,
    // constraint violation, whatever), the caller receives an error and
    // no bytes leave the process — the regulator's audit trail stays honest.
    await this.prisma.auditLog.create({
      data: {
        companyId: actor.companyId,
        actorId: actor.id,
        action: 'ROPA_EXPORTED',
        entityType: 'RopaRegistry',
        entityId: actor.companyId,
        afterJson: {
          format,
          rowCount: rows.length,
          sha256,
          bytes: bytes.length,
          generatedAt: header.generatedAt.toISOString(),
        },
      },
    });

    const stamp = header.generatedAt
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);
    const filename =
      format === 'PDF'
        ? `ropa-${company.id}-${stamp}.pdf`
        : `ropa-${company.id}-${stamp}.xlsx`;
    const contentType =
      format === 'PDF'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    return {
      format,
      filename,
      contentType,
      bytes,
      sha256,
      rowCount: rows.length,
    };
  }
}
