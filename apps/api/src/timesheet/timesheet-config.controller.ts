import { Body, Controller, Get, HttpCode, HttpStatus, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { TimesheetConfig } from '@prisma/client';

import { TimesheetConfigDto, UpdateTimesheetConfigDto } from './dto/timesheet.dto';
import { TimesheetConfigService } from './timesheet-config.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';


/**
 * `/admin/timesheet/config` — HR / Super Admin surface for the tenant's
 * timesheet configuration (Fase 32a). Mounted under the admin path so
 * the FE role gate + JWT guard already apply.
 */
@ApiTags('timesheet')
@Controller({ path: 'admin/timesheet/config', version: '1' })
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class TimesheetConfigController {
  constructor(private readonly service: TimesheetConfigService) {}

  @Get()
  @ApiBearerAuth()
  @ApiOkResponse({ type: TimesheetConfigDto })
  async getConfig(@CurrentUser() actor: AuthenticatedUser): Promise<TimesheetConfigDto> {
    const cfg = await this.service.getForCompany(actor.companyId);
    return toDto(cfg);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOkResponse({ type: TimesheetConfigDto })
  async updateConfig(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: UpdateTimesheetConfigDto,
  ): Promise<TimesheetConfigDto> {
    const cfg = await this.service.update({ id: actor.id, companyId: actor.companyId }, body);
    return toDto(cfg);
  }
}

function toDto(cfg: TimesheetConfig): TimesheetConfigDto {
  return {
    id: cfg.id,
    companyId: cfg.companyId,
    periodType: cfg.periodType,
    weekStartDay: cfg.weekStartDay,
    biweeklyAnchor: cfg.biweeklyAnchor ? cfg.biweeklyAnchor.toISOString().slice(0, 10) : null,
    cutoffDayOfMonth: cfg.cutoffDayOfMonth,
    timezone: cfg.timezone,
    autoGenerateEnabled: cfg.autoGenerateEnabled,
    reminderEnabled: cfg.reminderEnabled,
    submitReminderStartDays: cfg.submitReminderStartDays,
    submitReminderMaxDays: cfg.submitReminderMaxDays,
    approvalReminderStartDays: cfg.approvalReminderStartDays,
    approvalReminderMaxDays: cfg.approvalReminderMaxDays,
    updatedAt: cfg.updatedAt.toISOString(),
    updatedById: cfg.updatedById,
  };
}
