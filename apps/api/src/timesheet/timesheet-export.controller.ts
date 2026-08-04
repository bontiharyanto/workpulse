import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import {
  CreateExportShareDto,
  ExportShareListDto,
  ExportShareUrlDto,
  ExportTimesheetDto,
  TimesheetExportListDto,
} from './dto/timesheet.dto';
import { TimesheetExportShareService } from './timesheet-export-share.service';
import { TimesheetExportService } from './timesheet-export.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

/**
 * `/admin/timesheet/exports` — HR & Super-Admin payroll export surface.
 *
 * The POST endpoint streams a CSV or XLSX **and** commits a
 * `TimesheetExport` audit row containing the SHA-256 of the exact
 * byte-string returned. See ADR-0025 for the immutability model.
 */
@ApiTags('timesheet')
@Controller({ path: 'admin/timesheet/exports', version: '1' })
@Roles('HR_MANAGER', 'SUPER_ADMIN')
// Payroll runs are once-per-period per tenant. Cap at 10/min per client
// so a rogue script cannot brute-force the audit trail.
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class TimesheetExportController {
  constructor(
    private readonly service: TimesheetExportService,
    private readonly shares: TimesheetExportShareService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiBearerAuth()
  async export(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: ExportTimesheetDto,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const result = await this.service.export(actor, {
      periodId: body.periodId,
      format: body.format,
      mode: body.mode,
      departmentId: body.departmentId ?? null,
      note: body.note ?? null,
    });

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-Payload-Sha256', result.export.payloadSha256);
    res.setHeader('X-Export-Id', result.export.id);
    res.setHeader('Content-Length', String(result.payload.length));
    res.status(HttpStatus.OK).end(result.payload);
  }

  @Get()
  @ApiBearerAuth()
  @ApiOkResponse({ type: TimesheetExportListDto })
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('limit') limit?: string,
  ): Promise<TimesheetExportListDto> {
    const take = Math.max(1, Math.min(200, Number(limit ?? '50')));
    const items = await this.service.list(actor, take);
    return { items };
  }

  // ---- Share links (Fase 32d) ---------------------------------------------

  @Post(':id/shares')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiCreatedResponse({ type: ExportShareUrlDto })
  async createShare(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') exportId: string,
    @Body() body: CreateExportShareDto,
  ): Promise<ExportShareUrlDto> {
    const share = await this.shares.create(actor, exportId, {
      ttlHours: body.ttlHours,
      note: body.note ?? null,
    });
    return {
      id: share.id,
      url: share.url,
      expiresAt: share.expiresAt.toISOString(),
      note: share.note,
      createdAt: share.createdAt.toISOString(),
    };
  }

  @Get(':id/shares')
  @ApiBearerAuth()
  @ApiOkResponse({ type: ExportShareListDto })
  async listShares(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') exportId: string,
  ): Promise<ExportShareListDto> {
    const items = await this.shares.listForExport(actor, exportId);
    return { items };
  }

  @Post(':id/shares/:shareId/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiNoContentResponse()
  async revokeShare(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') exportId: string,
    @Param('shareId') shareId: string,
  ): Promise<void> {
    await this.shares.revoke(actor, exportId, shareId);
  }
}
