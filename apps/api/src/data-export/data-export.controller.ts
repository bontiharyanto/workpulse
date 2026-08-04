import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { DataExportRequest } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

import { DataExportService } from './data-export.service';
import {
  DataExportDownloadResponseDto,
  DataExportListResponseDto,
  DataExportRequestDto,
} from './dto/data-export.dto';

/**
 * Fase 31a — Data Subject Access Request (DSAR / data-portability).
 *
 * Every route is self-service and scoped to the caller. There is
 * intentionally NO admin endpoint here: HR cannot request exports
 * on behalf of employees (that would defeat the point) and any
 * legitimate legal-hold export is a separate, audited HR flow that
 * has not been built.
 *
 * Throttler policy is layered on top of the service-layer 24h
 * cooldown: 5 create attempts per hour keeps a broken client script
 * from generating audit noise even when every attempt is rejected
 * with `EXPORT_COOLDOWN`.
 */
@ApiTags('data-export')
@Controller({ path: 'me/data-export', version: '1' })
export class DataExportController {
  constructor(private readonly service: DataExportService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiCreatedResponse({ type: DataExportRequestDto })
  @ApiConflictResponse({
    description:
      '`EXPORT_ALREADY_PENDING` when an in-flight request exists, `EXPORT_COOLDOWN` when the 24h window has not elapsed.',
  })
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  async create(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DataExportRequestDto> {
    const row = await this.service.create(user.id, user.companyId);
    return toDto(row);
  }

  @Get()
  @ApiBearerAuth()
  @ApiOkResponse({ type: DataExportListResponseDto })
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DataExportListResponseDto> {
    const rows = await this.service.list(user.id);
    return { requests: rows.map(toDto) };
  }

  @Get(':id/download')
  @ApiBearerAuth()
  @ApiOkResponse({ type: DataExportDownloadResponseDto })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<DataExportDownloadResponseDto> {
    const { downloadUrl, expiresIn } = await this.service.getDownloadUrl(user.id, id);
    return { downloadUrl, expiresIn };
  }
}

function toDto(row: DataExportRequest): DataExportRequestDto {
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    failedAt: row.failedAt?.toISOString() ?? null,
    failureReason: row.failureReason ?? null,
    fileSize: row.fileSize ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    downloadUrl: null,
  };
}
