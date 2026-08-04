import {
  Controller,
  Get,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

import { RopaExportService } from './ropa-export.service';

/**
 * Fase 31d — ROPA export endpoints. Bytes are audited before being
 * streamed (see `RopaExportService.buildExport`).
 *
 * Rate-limit 10/min matches the timesheet export controller; regulator
 * exports are one-click events, not something a legitimate DPO does 100×
 * per minute.
 */
@ApiTags('admin · ropa · export')
@Controller('admin/ropa')
@Roles('HR_MANAGER', 'SUPER_ADMIN')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class RopaExportController {
  constructor(private readonly exporter: RopaExportService) {}

  @Get('export.pdf')
  async exportPdf(
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.exporter.buildExport(actor, 'PDF');
    this.writeAttachment(res, result.filename, result.contentType, result.bytes, result.sha256);
  }

  @Get('export.xlsx')
  async exportXlsx(
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.exporter.buildExport(actor, 'XLSX');
    this.writeAttachment(res, result.filename, result.contentType, result.bytes, result.sha256);
  }

  private writeAttachment(
    res: Response,
    filename: string,
    contentType: string,
    bytes: Buffer,
    sha256: string,
  ): void {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(bytes.length));
    // Payload hash surfaced so DPO can copy-paste it into their audit
    // notes (regulator: "prove the file the auditor received matches
    // what we shipped in Q3").
    res.setHeader('X-Payload-Sha256', sha256);
    res.status(HttpStatus.OK).end(bytes);
  }
}
