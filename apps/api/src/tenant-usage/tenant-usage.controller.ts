import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { TenantUsageSnapshot } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

import {
  ListTenantUsageQueryDto,
  ListTenantUsageResponseDto,
  RegenerateTenantUsageDto,
  TenantUsageSnapshotDto,
} from './dto/tenant-usage.dto';
import { TenantUsageService } from './tenant-usage.service';

/**
 * OPS-7 — Tenant usage snapshot admin surface.
 *
 *   - `HR_MANAGER` sees only their own tenant.
 *   - `SUPER_ADMIN` sees every tenant (cross-tenant table) and can
 *     regenerate any month for any tenant.
 */
@ApiTags('tenant-usage')
@Controller({ path: 'admin/usage', version: '1' })
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class TenantUsageController {
  constructor(private readonly service: TenantUsageService) {}

  @Get('snapshots')
  @ApiBearerAuth()
  @ApiOkResponse({ type: ListTenantUsageResponseDto })
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListTenantUsageQueryDto,
  ): Promise<ListTenantUsageResponseDto> {
    const scoping = this.resolveScope(actor, query.companyId);
    const res = await this.service.list({
      companyId: scoping,
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      rows: res.rows.map(toDto),
      total: res.total,
      page: res.page,
      pageSize: res.pageSize,
    };
  }

  @Get('current-month')
  @ApiBearerAuth()
  @ApiOkResponse({ type: TenantUsageSnapshotDto, isArray: false })
  async currentMonth(
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<TenantUsageSnapshotDto | null> {
    const row = await this.service.latestForCompany(actor.companyId);
    return row ? toDto(row) : null;
  }

  @Get('snapshots/:id')
  @ApiBearerAuth()
  @ApiOkResponse({ type: TenantUsageSnapshotDto })
  async detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<TenantUsageSnapshotDto> {
    const scope = actor.role === 'SUPER_ADMIN' ? null : actor.companyId;
    const row = await this.service.detail(scope, id);
    return toDto(row);
  }

  @Post('regenerate')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOkResponse({ type: TenantUsageSnapshotDto })
  async regenerate(@Body() body: RegenerateTenantUsageDto): Promise<TenantUsageSnapshotDto> {
    const row = await this.service.regenerateMonth(body.companyId, body.year, body.month);
    return toDto(row);
  }

  /**
   * Resolves the tenant scope from the actor's role. SUPER_ADMIN may
   * pass an optional `companyId` query to focus on one tenant; missing
   * = cross-tenant listing. HR_MANAGER is locked to their own tenant
   * regardless of what they typed.
   */
  private resolveScope(
    actor: AuthenticatedUser,
    requested: string | undefined,
  ): string | undefined {
    if (actor.role === 'SUPER_ADMIN') return requested;
    if (requested && requested !== actor.companyId) {
      throw new ForbiddenException('CROSS_TENANT_ACCESS_DENIED');
    }
    return actor.companyId;
  }
}

function toDto(row: TenantUsageSnapshot): TenantUsageSnapshotDto {
  return {
    id: row.id,
    companyId: row.companyId,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    generatedAt: row.generatedAt.toISOString(),
    storageExportBytes: row.storageExportBytes.toString(),
    storageDsarBytes: row.storageDsarBytes.toString(),
    storageTotalBytes: row.storageTotalBytes.toString(),
    attachmentBytesTracked: row.attachmentBytesTracked,
    dbRowsUser: row.dbRowsUser,
    dbRowsAttendance: row.dbRowsAttendance,
    dbRowsLeave: row.dbRowsLeave,
    dbRowsOvertime: row.dbRowsOvertime,
    dbRowsTimesheetEntry: row.dbRowsTimesheetEntry,
    dbRowsAuditLog: row.dbRowsAuditLog,
    dbRowsNotification: row.dbRowsNotification,
    dbRowsTimesheetExport: row.dbRowsTimesheetExport,
    dbRowsWebhookDelivery: row.dbRowsWebhookDelivery,
    dbRowsTotal: row.dbRowsTotal.toString(),
    notificationsCreated: row.notificationsCreated,
    webhookDeliveries: row.webhookDeliveries,
    activeUsers: row.activeUsers,
    totalUsers: row.totalUsers,
    notes: row.notes,
  };
}
