import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';


import { TimesheetSummaryDto, TimesheetViewDto } from './dto/timesheet.dto';
import { TimesheetSubmissionService } from './timesheet-submission.service';
import { TimesheetService } from './timesheet.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

/**
 * `/me/timesheet` — self-service surface for the currently authenticated
 * user. Every request is scoped to `actor.id` inside the service.
 */
@ApiTags('timesheet')
@Controller({ path: 'me/timesheet', version: '1' })
export class TimesheetSelfController {
  constructor(
    private readonly service: TimesheetService,
    private readonly submission: TimesheetSubmissionService,
  ) {}

  @Get('current')
  @ApiBearerAuth()
  @ApiOkResponse({
    type: TimesheetViewDto,
    description: 'null if no timesheet has been generated yet',
  })
  async current(@CurrentUser() actor: AuthenticatedUser): Promise<TimesheetViewDto | null> {
    return this.service.getCurrentForUser(actor);
  }

  @Get()
  @ApiBearerAuth()
  @ApiOkResponse({ type: [TimesheetSummaryDto] })
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('limit') limit?: string,
  ): Promise<TimesheetSummaryDto[]> {
    const take = Math.max(1, Math.min(50, Number(limit ?? '12')));
    return this.service.listForUser(actor.id, actor.companyId, take);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiOkResponse({ type: TimesheetViewDto })
  async detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<TimesheetViewDto> {
    return this.service.getDetail(actor, id);
  }

  /**
   * Employee submits their own timesheet for review (Fase 32b).
   * Legal from DRAFT or REJECTED; the period must have ended.
   */
  @Post(':id/submit')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiNoContentResponse()
  async submit(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.submission.submit(actor, id);
  }
}
