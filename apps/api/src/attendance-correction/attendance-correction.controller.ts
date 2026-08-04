import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import type { HydratedCorrection } from './attendance-correction.service';
import { AttendanceCorrectionService } from './attendance-correction.service';
import { CorrectionResponseDto } from './dto/correction-response.dto';
import { DecideCorrectionDto } from './dto/decide-correction.dto';
import { SubmitCorrectionDto } from './dto/submit-correction.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

@ApiTags('attendance-corrections')
@ApiBearerAuth()
@Controller({ path: 'attendance/corrections', version: '1' })
export class AttendanceCorrectionController {
  constructor(private readonly service: AttendanceCorrectionService) {}

  /**
   * File a correction. Available to any authenticated employee — the
   * request is scoped to `actor.id` at the service layer, so SUPERVISOR /
   * HR calling this endpoint submits on THEIR OWN behalf (self-service),
   * not on someone else's. HR overrides for another user's punch go
   * through the manual absence endpoint instead.
   */
  @Post()
  @Roles('EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER')
  @ApiOkResponse({ type: CorrectionResponseDto })
  async submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitCorrectionDto,
  ): Promise<CorrectionResponseDto> {
    const created = await this.service.submit(user, {
      workDate: dto.workDate,
      requestedClockInAt: dto.requestedClockInAt ?? null,
      requestedClockOutAt: dto.requestedClockOutAt ?? null,
      reason: dto.reason,
      attachmentKey: dto.attachmentKey,
    });
    const [hydrated] = await this.service.hydrate([created]);
    return this.toDto(hydrated!);
  }

  @Get('mine')
  @Roles('EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER')
  @ApiOkResponse({ type: CorrectionResponseDto, isArray: true })
  async listMine(@CurrentUser() user: AuthenticatedUser): Promise<CorrectionResponseDto[]> {
    const rows = await this.service.listMine(user);
    const hydrated = await this.service.hydrate(rows);
    return Promise.all(hydrated.map((h) => this.toDto(h)));
  }

  @Get('approvals/pending')
  @Roles('SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN')
  @ApiOkResponse({ type: CorrectionResponseDto, isArray: true })
  async listApprovals(@CurrentUser() user: AuthenticatedUser): Promise<CorrectionResponseDto[]> {
    const rows = await this.service.listPendingApprovals(user);
    const hydrated = await this.service.hydrate(rows, { includeRequester: true });
    return Promise.all(hydrated.map((h) => this.toDto(h)));
  }

  @Post(':id/decision')
  @Roles('SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CorrectionResponseDto })
  async decide(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DecideCorrectionDto,
  ): Promise<CorrectionResponseDto> {
    const updated = await this.service.decide(actor, id, dto);
    const [hydrated] = await this.service.hydrate([updated], {
      includeRequester: true,
    });
    return this.toDto(hydrated!);
  }

  @Post(':id/cancel')
  @Roles('EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CorrectionResponseDto })
  async cancel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<CorrectionResponseDto> {
    const updated = await this.service.cancel(actor, id);
    const [hydrated] = await this.service.hydrate([updated]);
    return this.toDto(hydrated!);
  }

  private async toDto(h: HydratedCorrection): Promise<CorrectionResponseDto> {
    const r = h.request;
    const attachmentUrl = await this.service.presignAttachmentUrl(r.attachmentUrl);
    return {
      id: r.id,
      userId: r.userId,
      userFullName: h.userFullName,
      workDate: r.workDate.toISOString().slice(0, 10),
      requestedClockInAt: r.requestedClockInAt ? r.requestedClockInAt.toISOString() : null,
      requestedClockOutAt: r.requestedClockOutAt ? r.requestedClockOutAt.toISOString() : null,
      reason: r.reason,
      attachmentUrl,
      status: r.status,
      supervisorId: r.supervisorId,
      decidedById: r.decidedById,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
