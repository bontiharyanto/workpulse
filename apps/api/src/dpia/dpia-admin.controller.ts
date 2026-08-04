import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { toAssessmentDto, toListItemDto } from './dpia-mapper';
import { DpiaService } from './dpia.service';
import {
  CreateDpiaAssessmentDto,
  CreateDpiaRiskItemDto,
  DpiaAssessmentListItemDto,
  DpiaAssessmentResponseDto,
  UpdateDpiaAssessmentDto,
  UpdateDpiaRiskItemDto,
} from './dto/dpia.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

/**
 * Fase 31e — HR / Super Admin DPIA controller.
 *
 * RBAC: `HR_MANAGER` and `SUPER_ADMIN` only. Employees + supervisors
 * cannot access DPIA — the risk register frequently references
 * security incidents that require need-to-know handling.
 *
 * Throttling: writes 30/min, seed-like bulk endpoints capped harder.
 */
@ApiTags('admin · dpia')
@Controller('admin/dpia')
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class DpiaAdminController {
  constructor(private readonly service: DpiaService) {}

  @Get('assessments')
  async list(@CurrentUser() actor: AuthenticatedUser): Promise<DpiaAssessmentListItemDto[]> {
    const rows = await this.service.list(actor);
    return rows.map((r) => toListItemDto(r));
  }

  @Get('assessments/:id')
  async detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<DpiaAssessmentResponseDto> {
    return toAssessmentDto(await this.service.detail(actor, id));
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('assessments')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateDpiaAssessmentDto,
  ): Promise<DpiaAssessmentResponseDto> {
    return toAssessmentDto(await this.service.createAssessment(actor, body));
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Patch('assessments/:id')
  async patch(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateDpiaAssessmentDto,
  ): Promise<DpiaAssessmentResponseDto> {
    return toAssessmentDto(await this.service.updateAssessment(actor, id, body));
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('assessments/:id/submit-review')
  @HttpCode(HttpStatus.OK)
  async submitReview(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<DpiaAssessmentResponseDto> {
    return toAssessmentDto(await this.service.submitReview(actor, id));
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('assessments/:id/return-to-draft')
  @HttpCode(HttpStatus.OK)
  async returnToDraft(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<DpiaAssessmentResponseDto> {
    return toAssessmentDto(await this.service.returnToDraft(actor, id));
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('assessments/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<DpiaAssessmentResponseDto> {
    return toAssessmentDto(await this.service.approve(actor, id));
  }

  // -------- Risk items --------

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('assessments/:id/risk-items')
  @HttpCode(HttpStatus.CREATED)
  async addRisk(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') assessmentId: string,
    @Body() body: CreateDpiaRiskItemDto,
  ): Promise<DpiaAssessmentResponseDto> {
    return toAssessmentDto(await this.service.addRiskItem(actor, assessmentId, body));
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Patch('assessments/:id/risk-items/:riskItemId')
  async patchRisk(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') assessmentId: string,
    @Param('riskItemId') riskItemId: string,
    @Body() body: UpdateDpiaRiskItemDto,
  ): Promise<DpiaAssessmentResponseDto> {
    return toAssessmentDto(
      await this.service.updateRiskItem(actor, assessmentId, riskItemId, body),
    );
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Delete('assessments/:id/risk-items/:riskItemId')
  async removeRisk(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') assessmentId: string,
    @Param('riskItemId') riskItemId: string,
  ): Promise<DpiaAssessmentResponseDto> {
    return toAssessmentDto(await this.service.removeRiskItem(actor, assessmentId, riskItemId));
  }
}
