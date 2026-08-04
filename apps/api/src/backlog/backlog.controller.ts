import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { BacklogService } from './backlog.service';
import type { BacklogItem, BacklogSummary, ModuleBacklog } from './backlog.service';
import { BacklogSummaryDto } from './dto/backlog.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

@ApiTags('admin-backlog')
@ApiBearerAuth()
@Controller({ path: 'admin/approvals', version: '1' })
export class BacklogController {
  constructor(private readonly service: BacklogService) {}

  /**
   * Cross-module PENDING approval visibility for HR.
   *
   * Only HR_MANAGER + SUPER_ADMIN — see BacklogService docstring for the
   * "why not supervisors" rationale. Supervisors keep using the
   * per-module `/approvals/pending` endpoints which are already scoped
   * to their direct reports.
   */
  @Get('backlog')
  @Roles('HR_MANAGER', 'SUPER_ADMIN')
  @ApiOkResponse({ type: BacklogSummaryDto })
  async getBacklog(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('thresholdDays') thresholdRaw?: string,
    @Query('topN') topNRaw?: string,
  ): Promise<BacklogSummaryDto> {
    const staleAfterDays =
      thresholdRaw === undefined ? undefined : parseIntStrict(thresholdRaw, 'thresholdDays');
    const topN = topNRaw === undefined ? undefined : parseIntStrict(topNRaw, 'topN');

    const summary = await this.service.getBacklog({
      companyId: actor.companyId,
      now: new Date(),
      staleAfterDays,
      topN,
    });
    return serializeBacklog(summary);
  }
}

// ---------------------------------------------------------------------------

function parseIntStrict(raw: string, field: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new BadRequestException(`${field.toUpperCase()}_NOT_INTEGER`);
  }
  return n;
}

function serializeBacklog(s: BacklogSummary): BacklogSummaryDto {
  return {
    generatedAt: s.generatedAt.toISOString(),
    staleAfterDays: s.staleAfterDays,
    leave: serializeModule(s.leave),
    overtime: serializeModule(s.overtime),
    correction: serializeModule(s.correction),
  };
}

function serializeModule(m: ModuleBacklog) {
  return {
    total: m.total,
    fresh: m.fresh,
    stale: m.stale,
    buckets: m.buckets,
    oldest: m.oldest.map(serializeItem),
  };
}

function serializeItem(i: BacklogItem) {
  return {
    id: i.id,
    userId: i.userId,
    userFullName: i.userFullName,
    createdAt: i.createdAt.toISOString(),
    ageDays: i.ageDays,
    summary: i.summary,
  };
}
