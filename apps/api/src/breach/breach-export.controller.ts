import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { BreachExportService } from './breach-export.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';


/**
 * Fase 31g — regulator PDF download endpoint.
 *
 * Split into its own controller so the export-specific throttle
 * (10/min) does not accidentally starve the read/write endpoints
 * during normal ledger operations.
 */
@ApiTags('admin · security · breach · export')
@Controller('admin/security/breaches')
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class BreachExportController {
  constructor(private readonly service: BreachExportService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get(':id/export.pdf')
  @Header('Cache-Control', 'no-store')
  async exportPdf(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.service.exportPdf(actor, id);
    res
      .header('Content-Type', result.contentType)
      .header('Content-Disposition', `attachment; filename="${result.filename}"`)
      .header('X-Payload-Sha256', result.sha256)
      .header('Content-Length', String(result.bytes.byteLength))
      .status(200)
      .send(result.bytes);
  }
}
