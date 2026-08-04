import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { DataErasureRequest, User } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import { DataErasureService } from './data-erasure.service';
import {
  DataErasureAdminListResponseDto,
  DataErasureAdminRequestDto,
  DecideErasureDto,
  RejectErasureDto,
} from './dto/data-erasure.dto';

/**
 * Admin-side erasure surface (Fase 31b). Restricted to HR_MANAGER
 * and SUPER_ADMIN via the shared `RolesGuard` — either role can
 * approve. The self-approval guard inside `DataErasureService.approve`
 * closes the "HR erases themselves" hole.
 *
 * We hydrate the requester's name/email for the queue view so the
 * FE does not need to fan out to `/users/:id` per row.
 */
@ApiTags('data-erasure-admin')
@Controller({ path: 'admin/data-erasure', version: '1' })
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class DataErasureAdminController {
  constructor(
    private readonly service: DataErasureService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('pending')
  @ApiBearerAuth()
  @ApiOkResponse({ type: DataErasureAdminListResponseDto })
  async listPending(
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DataErasureAdminListResponseDto> {
    const rows = await this.service.listPending(actor.companyId);
    return { requests: await this.hydrate(rows) };
  }

  @Get()
  @ApiBearerAuth()
  @ApiOkResponse({ type: DataErasureAdminListResponseDto })
  async listAll(@CurrentUser() actor: AuthenticatedUser): Promise<DataErasureAdminListResponseDto> {
    const rows = await this.service.listAll(actor.companyId);
    return { requests: await this.hydrate(rows) };
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiConflictResponse({
    description: '`ERASURE_INVALID_TRANSITION` when the request is not PENDING_APPROVAL.',
  })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async approve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: DecideErasureDto,
  ): Promise<DataErasureAdminRequestDto> {
    const row = await this.service.approve(
      { id: actor.id, role: actor.role, companyId: actor.companyId },
      id,
      body.note,
    );
    return (await this.hydrate([row]))[0]!;
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async reject(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: RejectErasureDto,
  ): Promise<DataErasureAdminRequestDto> {
    const row = await this.service.reject(
      { id: actor.id, role: actor.role, companyId: actor.companyId },
      id,
      body.note,
    );
    return (await this.hydrate([row]))[0]!;
  }

  private async hydrate(rows: DataErasureRequest[]): Promise<DataErasureAdminRequestDto[]> {
    if (rows.length === 0) return [];
    // One roundtrip regardless of the queue size.
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
      select: { id: true, fullName: true, email: true },
    });
    const byId = new Map<string, Pick<User, 'id' | 'fullName' | 'email'>>();
    for (const u of users) byId.set(u.id, u);

    return rows.map((row) => {
      const user = byId.get(row.userId);
      return {
        id: row.id,
        userId: row.userId,
        companyId: row.companyId,
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
        requesterName: user?.fullName ?? '(unknown)',
        requesterEmail: user?.email ?? '(unknown)',
      };
    });
  }
}
