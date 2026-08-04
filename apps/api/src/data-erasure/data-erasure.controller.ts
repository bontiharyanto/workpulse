import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { DataErasureRequest } from '@prisma/client';

import { DataErasureService } from './data-erasure.service';
import {
  CreateErasureRequestDto,
  DataErasureListResponseDto,
  DataErasureRequestDto,
} from './dto/data-erasure.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

/**
 * Self-service right-to-erasure surface (Fase 31b). Every route is
 * scoped to the caller — there is intentionally no admin variant
 * here; HR / admin flows live on `DataErasureAdminController`.
 *
 * Throttle policy: creating an erasure request is a rare event but
 * a broken client script that hammers the endpoint would still
 * generate audit noise. 10 attempts per hour is generous for a
 * legitimate user (a single tab retry) while catching abuse.
 */
@ApiTags('data-erasure')
@Controller({ path: 'me/data-erasure', version: '1' })
export class DataErasureController {
  constructor(private readonly service: DataErasureService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiCreatedResponse({ type: DataErasureRequestDto })
  @ApiConflictResponse({
    description: '`ERASURE_ALREADY_PENDING` when an active request exists for the caller.',
  })
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateErasureRequestDto,
  ): Promise<DataErasureRequestDto> {
    const row = await this.service.create(user.id, user.companyId, body.reason);
    return toDto(row);
  }

  @Get()
  @ApiBearerAuth()
  @ApiOkResponse({ type: DataErasureListResponseDto })
  async list(@CurrentUser() user: AuthenticatedUser): Promise<DataErasureListResponseDto> {
    const rows = await this.service.list(user.id);
    return { requests: rows.map(toDto) };
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOkResponse({ type: DataErasureRequestDto })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<DataErasureRequestDto> {
    const row = await this.service.cancel(user.id, id);
    return toDto(row);
  }
}

export function toDto(row: DataErasureRequest): DataErasureRequestDto {
  return {
    id: row.id,
    status: row.status,
    reason: row.reason,
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedById: row.decidedById,
    decisionNote: row.decisionNote,
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    executedAt: row.executedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    failedAt: row.failedAt?.toISOString() ?? null,
    failureReason: row.failureReason,
  };
}
