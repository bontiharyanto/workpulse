import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { RetentionAuditReport } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

import {
  ListRetentionAuditQueryDto,
  ListRetentionAuditResponseDto,
  RegenerateRetentionAuditDto,
  RetentionAuditReportDto,
  type RetentionAuditFindingKindLiteral,
  type RetentionAuditStatusLiteral,
} from './dto/retention-audit.dto';
import { RetentionAuditService } from './retention-audit.service';

/**
 * OPS-6 — Monthly retention audit read + regenerate surface.
 *
 * Mounted under `/admin/privacy/retention/audit-reports` so the
 * FE nav already lives inside the privacy admin section.
 *
 * HR_MANAGER can view + regenerate; SUPER_ADMIN inherits both.
 */
@ApiTags('retention-audit')
@Controller({
  path: 'admin/privacy/retention/audit-reports',
  version: '1',
})
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class RetentionAuditController {
  constructor(private readonly service: RetentionAuditService) {}

  @Get()
  @ApiBearerAuth()
  @ApiOkResponse({ type: ListRetentionAuditResponseDto })
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListRetentionAuditQueryDto,
  ): Promise<ListRetentionAuditResponseDto> {
    const res = await this.service.list(actor.companyId, {
      status: query.status,
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

  @Get('latest')
  @ApiBearerAuth()
  @ApiOkResponse({ type: RetentionAuditReportDto, isArray: false })
  async latest(@CurrentUser() actor: AuthenticatedUser): Promise<RetentionAuditReportDto | null> {
    const row = await this.service.latestForCompany(actor.companyId);
    return row ? toDto(row) : null;
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiOkResponse({ type: RetentionAuditReportDto })
  async detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<RetentionAuditReportDto> {
    const row = await this.service.detail(actor.companyId, id);
    return toDto(row);
  }

  @Post('regenerate')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOkResponse({ type: RetentionAuditReportDto })
  async regenerate(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: RegenerateRetentionAuditDto,
  ): Promise<RetentionAuditReportDto> {
    const row = await this.service.regenerateMonth(actor.companyId, body.year, body.month);
    return toDto(row);
  }
}

function toDto(row: RetentionAuditReport): RetentionAuditReportDto {
  const rawFindings = Array.isArray(row.findings) ? row.findings : [];
  const rawSnapshot = (row.policySnapshot ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    companyId: row.companyId,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    generatedAt: row.generatedAt.toISOString(),
    status: row.status as RetentionAuditStatusLiteral,
    notificationsPruned: row.notificationsPruned,
    usersAutoAnonymised: row.usersAutoAnonymised,
    dsarArchivesExpired: row.dsarArchivesExpired,
    notificationsPastRetention: row.notificationsPastRetention,
    dsarArchivesPastRetention: row.dsarArchivesPastRetention,
    terminatedUsersPastRetention: row.terminatedUsersPastRetention,
    policySnapshot: {
      notificationRetentionDays: (rawSnapshot['notificationRetentionDays'] as number) ?? 0,
      dataExportArchiveRetentionHours:
        (rawSnapshot['dataExportArchiveRetentionHours'] as number) ?? 0,
      terminatedUserAnonymizeDays: (rawSnapshot['terminatedUserAnonymizeDays'] as number) ?? 0,
    },
    workerLastRunAt: row.workerLastRunAt ? row.workerLastRunAt.toISOString() : null,
    findings: rawFindings.map((f) => {
      const entry = f as Record<string, unknown>;
      return {
        kind: entry['kind'] as RetentionAuditFindingKindLiteral,
        severity: entry['severity'] as 'info' | 'warning' | 'critical',
        count: typeof entry['count'] === 'number' ? (entry['count'] as number) : undefined,
        message: (entry['message'] as string) ?? '',
      };
    }),
    notes: row.notes,
  };
}
