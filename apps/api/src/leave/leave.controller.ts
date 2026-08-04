import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { LeaveBalance, LeaveType } from '@prisma/client';

import { AttachmentService } from '../attachment/attachment.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

import { DecideLeaveDto } from './dto/decide-leave.dto';
import { LeaveBalanceDto, LeaveRequestDto } from './dto/leave-response.dto';
import { SubmitLeaveDto } from './dto/submit-leave.dto';
import type { HydratedLeaveRequest } from './leave.service';
import { LeaveService } from './leave.service';

@ApiTags('leave')
@ApiBearerAuth()
@Controller({ path: 'leave', version: '1' })
export class LeaveController {
  constructor(
    private readonly leave: LeaveService,
    private readonly attachments: AttachmentService,
  ) {}

  @Post()
  @Roles('EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER')
  @ApiOkResponse({ type: LeaveRequestDto })
  async submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitLeaveDto,
  ): Promise<LeaveRequestDto> {
    const created = await this.leave.submit(user, dto);
    const [hydrated] = await this.leave.hydrateRequests([created]);
    return this.toRequestDto(hydrated!);
  }

  @Get('types')
  @Roles('EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN')
  @ApiOkResponse({ description: "Available leave types in the caller's company" })
  listTypes(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Array<{ id: string; code: string; name: string; kind: LeaveType['kind']; requiresAttachment: boolean }>> {
    return this.leave.listAvailableTypes(user);
  }

  @Get('mine')
  @Roles('EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER')
  @ApiOkResponse({ type: LeaveRequestDto, isArray: true })
  async listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') year?: string,
  ): Promise<LeaveRequestDto[]> {
    const rows = await this.leave.listMine(user, year ? Number(year) : undefined);
    const hydrated = await this.leave.hydrateRequests(rows);
    return Promise.all(hydrated.map((h) => this.toRequestDto(h)));
  }

  @Get('balance')
  @Roles('EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER')
  @ApiOkResponse({ type: LeaveBalanceDto, isArray: true })
  async myBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') year?: string,
  ): Promise<LeaveBalanceDto[]> {
    const rows = await this.leave.getBalances(user, year ? Number(year) : undefined);
    return rows.map((b) =>
      toBalanceDto(b, (b as unknown as { leaveType: LeaveType }).leaveType),
    );
  }

  @Get('approvals/pending')
  @Roles('SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN')
  @ApiOkResponse({ type: LeaveRequestDto, isArray: true })
  async listApprovals(@CurrentUser() user: AuthenticatedUser): Promise<LeaveRequestDto[]> {
    const rows = await this.leave.listPendingApprovals(user);
    const hydrated = await this.leave.hydrateRequests(rows, { includeRequester: true });
    return Promise.all(hydrated.map((h) => this.toRequestDto(h)));
  }

  @Post(':id/decision')
  @Roles('SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LeaveRequestDto })
  async decide(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DecideLeaveDto,
  ): Promise<LeaveRequestDto> {
    const updated = await this.leave.decide(actor, id, dto);
    const [hydrated] = await this.leave.hydrateRequests([updated], { includeRequester: true });
    return this.toRequestDto(hydrated!);
  }

  @Post(':id/cancel')
  @Roles('EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LeaveRequestDto })
  async cancel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<LeaveRequestDto> {
    const updated = await this.leave.cancel(actor, id);
    const [hydrated] = await this.leave.hydrateRequests([updated]);
    return this.toRequestDto(hydrated!);
  }

  /**
   * The DB stores an S3 **key** in `attachmentUrl` (see LeaveService). We
   * regenerate a short-lived presigned GET URL on every read so the browser
   * link is only usable for a bounded window. `presignGet` is best-effort:
   * if storage is disabled or the key is malformed the field falls back to
   * `null` — never leak internal keys to the client.
   */
  private async toRequestDto(h: HydratedLeaveRequest): Promise<LeaveRequestDto> {
    const r = h.request;
    let attachmentUrl: string | null = null;
    if (r.attachmentUrl) {
      try {
        const signed = await this.attachments.presignGet(r.attachmentUrl);
        attachmentUrl = signed.url;
      } catch {
        // Storage disabled in tests / dev — omit the URL rather than 500 the whole list.
        attachmentUrl = null;
      }
    }
    return {
      id: r.id,
      userId: r.userId,
      userFullName: h.userFullName,
      leaveTypeId: r.leaveTypeId,
      leaveTypeName: h.leaveTypeName,
      leaveTypeKind: h.leaveTypeKind,
      status: r.status,
      startDate: r.startDate.toISOString().slice(0, 10),
      endDate: r.endDate.toISOString().slice(0, 10),
      days: r.days,
      reason: r.reason,
      attachmentUrl,
      supervisorId: r.supervisorId,
      hrManagerId: r.hrManagerId,
      supervisorAt: r.supervisorAt ? r.supervisorAt.toISOString() : null,
      hrManagerAt: r.hrManagerAt ? r.hrManagerAt.toISOString() : null,
      supervisorNote: r.supervisorNote,
      hrManagerNote: r.hrManagerNote,
      createdAt: r.createdAt.toISOString(),
    };
  }
}

function toBalanceDto(b: LeaveBalance, t: LeaveType): LeaveBalanceDto {
  return {
    leaveTypeId: t.id,
    leaveTypeCode: t.code,
    leaveTypeName: t.name,
    kind: t.kind,
    year: b.year,
    quota: b.quota,
    carriedOver: b.carriedOver,
    used: b.used,
    reserved: b.reserved,
    remaining: b.remaining,
  };
}
