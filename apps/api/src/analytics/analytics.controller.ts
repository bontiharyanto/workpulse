import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

import { AnalyticsQueryService } from './analytics-query.service';
import {
  DashboardQueryDto,
  DashboardResponseDto,
  TimeseriesQueryDto,
  TimeseriesResponseDto,
} from './dto/analytics.dto';

/**
 * Fase 33a — executive-KPI dashboard read API.
 *
 * Both endpoints:
 *   * Are HR / super-admin only. Employees + supervisors do NOT see
 *     tenant-wide aggregates.
 *   * Are throttled at 60/min to protect the DB when a stakeholder is
 *     rapidly flipping between window sizes on the UI.
 *   * Scope all reads by the actor's `companyId` inside the service so
 *     no cross-tenant leak is possible.
 */
@ApiTags('admin · analytics')
@Controller('admin/analytics')
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsQueryService) {}

  @Get('dashboard')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async dashboard(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
  ): Promise<DashboardResponseDto> {
    const result = await this.service.getDashboard(actor, query.windowDays);
    return result as DashboardResponseDto;
  }

  @Get('timeseries')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async timeseries(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: TimeseriesQueryDto,
  ): Promise<TimeseriesResponseDto> {
    const result = await this.service.getTimeseries(actor, query.metricKey, query.windowDays);
    return result as TimeseriesResponseDto;
  }
}
