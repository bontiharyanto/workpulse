import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TimesheetStatus } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

import {
  DecideTimesheetDto,
  GenerateTimesheetDto,
  GenerateTimesheetResponseDto,
  ReopenTimesheetDto,
  ReopenTimesheetResponseDto,
  TimesheetListDto,
  TimesheetPeriodListDto,
  TimesheetViewDto,
} from './dto/timesheet.dto';
import { TimesheetSubmissionService } from './timesheet-submission.service';
import { TimesheetService } from './timesheet.service';

/**
 * `/admin/timesheet` — HR-Manager / Super-Admin queue view + generate
 * action. Supervisors can also GET, but the service scopes their
 * result set to their direct reports (see `TimesheetService.listAdmin`).
 */
@ApiTags('timesheet')
@Controller({ path: 'admin/timesheet', version: '1' })
@Roles('SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN')
export class TimesheetAdminController {
  constructor(
    private readonly service: TimesheetService,
    private readonly submission: TimesheetSubmissionService,
  ) {}

  @Get('periods')
  @ApiBearerAuth()
  @ApiOkResponse({ type: TimesheetPeriodListDto })
  async listPeriods(@CurrentUser() actor: AuthenticatedUser): Promise<TimesheetPeriodListDto> {
    const items = await this.service.listPeriods(actor.companyId);
    return { items };
  }

  @Post('generate')
  @Roles('HR_MANAGER', 'SUPER_ADMIN') // narrow the parent decorator
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOkResponse({ type: GenerateTimesheetResponseDto })
  async generate(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: GenerateTimesheetDto,
  ): Promise<GenerateTimesheetResponseDto> {
    const at = body.at ? new Date(body.at) : new Date();
    return this.service.generateForPeriod(actor.companyId, at);
  }

  @Get()
  @ApiBearerAuth()
  @ApiOkResponse({ type: TimesheetListDto })
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('periodId') periodId?: string,
    @Query('userId') userId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: TimesheetStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<TimesheetListDto> {
    const take = Math.max(1, Math.min(200, Number(limit ?? '50')));
    const skip = Math.max(0, Number(offset ?? '0'));
    const parsedStatus =
      status && Object.values(TimesheetStatus).includes(status) ? status : undefined;
    return this.service.listAdmin(
      actor,
      { periodId, userId, departmentId, status: parsedStatus },
      take,
      skip,
    );
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
   * Supervisor or HR decides on a submitted timesheet (Fase 32b).
   * The submission service enforces:
   *   - state machine (only PENDING_SUPERVISOR / PENDING_HR)
   *   - role gate (supervisor-of-user OR HR / SUPER_ADMIN)
   *   - reject-note requirement
   */
  @Post(':id/decide')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiNoContentResponse()
  async decide(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: DecideTimesheetDto,
  ): Promise<void> {
    await this.submission.decide(actor, id, {
      action: body.action,
      note: body.note ?? null,
    });
  }

  /**
   * HR / Super Admin reopen an APPROVED timesheet after payroll is
   * already out (Fase 32g). Row is reset to DRAFT so the employee
   * can review + re-submit, walking the full chain again. See
   * `TimesheetSubmissionService.reopen` for invariants.
   */
  @Post(':id/reopen')
  @Roles('HR_MANAGER', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOkResponse({ type: ReopenTimesheetResponseDto })
  async reopen(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: ReopenTimesheetDto,
  ): Promise<ReopenTimesheetResponseDto> {
    return this.submission.reopen(actor, id, body.reason);
  }
}
