import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { DpiaExportService } from './dpia-export.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';


/**
 * Fase 31e — DPIA export controller.
 *
 * Separate controller so `/admin/dpia/assessments/:id/export.pdf`
 * can be aggressively throttled without touching the read endpoints.
 * The service performs the audit write, so this file is just I/O.
 */
@ApiTags('admin · dpia · export')
@Controller('admin/dpia')
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class DpiaExportController {
  constructor(private readonly service: DpiaExportService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('assessments/:id/export.pdf')
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
