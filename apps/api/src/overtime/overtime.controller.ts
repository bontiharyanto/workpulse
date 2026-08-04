import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

import { DecideOvertimeDto } from './dto/decide-overtime.dto';
import { OvertimeRequestDto } from './dto/overtime-response.dto';
import { SubmitOvertimeDto } from './dto/submit-overtime.dto';
import type { HydratedOvertime } from './overtime.service';
import { OvertimeService } from './overtime.service';

@ApiTags('overtime')
@ApiBearerAuth()
@Controller({ path: 'overtime', version: '1' })
export class OvertimeController {
  constructor(private readonly overtime: OvertimeService) {}

  @Post()
  @Roles('EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER')
  @ApiOkResponse({ type: OvertimeRequestDto })
  async submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitOvertimeDto,
  ): Promise<OvertimeRequestDto> {
    const created = await this.overtime.submit(user, dto);
    const [hydrated] = await this.overtime.hydrate([created]);
    return toRequestDto(hydrated!);
  }

  @Get('mine')
  @Roles('EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER')
  @ApiOkResponse({ type: OvertimeRequestDto, isArray: true })
  async listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') year?: string,
  ): Promise<OvertimeRequestDto[]> {
    const rows = await this.overtime.listMine(user, year ? Number(year) : undefined);
    const hydrated = await this.overtime.hydrate(rows);
    return hydrated.map(toRequestDto);
  }

  @Get('approvals/pending')
  @Roles('SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN')
  @ApiOkResponse({ type: OvertimeRequestDto, isArray: true })
  async listApprovals(@CurrentUser() user: AuthenticatedUser): Promise<OvertimeRequestDto[]> {
    const rows = await this.overtime.listPendingApprovals(user);
    const hydrated = await this.overtime.hydrate(rows, { includeRequester: true });
    return hydrated.map(toRequestDto);
  }

  @Post(':id/decision')
  @Roles('SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: OvertimeRequestDto })
  async decide(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DecideOvertimeDto,
  ): Promise<OvertimeRequestDto> {
    const updated = await this.overtime.decide(actor, id, dto);
    const [hydrated] = await this.overtime.hydrate([updated], { includeRequester: true });
    return toRequestDto(hydrated!);
  }

  @Post(':id/cancel')
  @Roles('EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: OvertimeRequestDto })
  async cancel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<OvertimeRequestDto> {
    const updated = await this.overtime.cancel(actor, id);
    const [hydrated] = await this.overtime.hydrate([updated]);
    return toRequestDto(hydrated!);
  }
}

function toRequestDto(h: HydratedOvertime): OvertimeRequestDto {
  const r = h.request;
  return {
    id: r.id,
    userId: r.userId,
    userFullName: h.userFullName,
    workDate: r.workDate.toISOString().slice(0, 10),
    hours: Number(r.hours.toString()),
    reason: r.reason,
    status: r.status,
    dayKind: h.dayKind,
    baseRate: Number(r.baseRate.toString()),
    rateMultiplier: Number(r.rateMultiplier.toString()),
    ratePerHour: Number(r.ratePerHour.toString()),
    totalAmount: Number(r.totalAmount.toString()),
    approvedById: r.approvedById,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    rejectedAt: r.rejectedAt ? r.rejectedAt.toISOString() : null,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt.toISOString(),
  };
}
