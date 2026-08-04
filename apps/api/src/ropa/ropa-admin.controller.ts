import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

import {
  CreateRopaActivityDto,
  RopaActivityDetailDto,
  RopaActivityListItemDto,
  RopaVersionResponseDto,
  SeedRopaResponseDto,
  UpdateRopaVersionDto,
} from './dto/ropa.dto';
import { toDetailDto, toListItemDto, toVersionDto } from './ropa-mapper';
import { RopaRegistryService } from './ropa-registry.service';

/**
 * Fase 31d — HR / Super Admin ROPA registry controller.
 *
 * All endpoints scoped by the actor's `companyId` inside the service.
 * Writes rate-limited to prevent audit-log spam; reads unthrottled since
 * DPOs may click quickly while reviewing.
 */
@ApiTags('admin · ropa')
@Controller('admin/ropa')
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class RopaAdminController {
  constructor(private readonly service: RopaRegistryService) {}

  @Get('activities')
  async list(@CurrentUser() actor: AuthenticatedUser): Promise<RopaActivityListItemDto[]> {
    const items = await this.service.list(actor);
    return items.map(toListItemDto);
  }

  @Get('activities/:id')
  async detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<RopaActivityDetailDto> {
    const detail = await this.service.detail(actor, id);
    return toDetailDto(detail);
  }

  @Post('activities')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateRopaActivityDto,
  ): Promise<RopaVersionResponseDto> {
    const created = await this.service.createActivity(actor, {
      slug: body.slug,
      name: body.name,
      purpose: body.purpose,
      legalBasis: body.legalBasis,
      legalBasisDetail: body.legalBasisDetail ?? null,
      dataCategories: body.dataCategories,
      subjectCategories: body.subjectCategories,
      recipients: body.recipients,
      retentionPeriod: body.retentionPeriod,
      crossBorderTransfer: body.crossBorderTransfer,
      crossBorderDetail: body.crossBorderDetail ?? null,
      securityMeasures: body.securityMeasures,
      notes: body.notes ?? null,
    });
    return toVersionDto(created);
  }

  @Post('seed-defaults')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async seed(@CurrentUser() actor: AuthenticatedUser): Promise<SeedRopaResponseDto> {
    return this.service.seedDefaults(actor);
  }

  @Patch('activities/:activityId/versions/:versionId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async patch(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('activityId') activityId: string,
    @Param('versionId') versionId: string,
    @Body() body: UpdateRopaVersionDto,
  ): Promise<RopaVersionResponseDto> {
    const updated = await this.service.patchVersion(actor, activityId, versionId, {
      name: body.name,
      purpose: body.purpose,
      legalBasis: body.legalBasis,
      legalBasisDetail: body.legalBasisDetail,
      dataCategories: body.dataCategories,
      subjectCategories: body.subjectCategories,
      recipients: body.recipients,
      retentionPeriod: body.retentionPeriod,
      crossBorderTransfer: body.crossBorderTransfer,
      crossBorderDetail: body.crossBorderDetail,
      securityMeasures: body.securityMeasures,
      notes: body.notes,
    });
    return toVersionDto(updated);
  }

  @Post('activities/:activityId/versions/:versionId/submit-review')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async submit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('activityId') activityId: string,
    @Param('versionId') versionId: string,
  ): Promise<RopaVersionResponseDto> {
    const updated = await this.service.submitReview(actor, activityId, versionId);
    return toVersionDto(updated);
  }

  @Post('activities/:activityId/versions/:versionId/return-to-draft')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async returnToDraft(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('activityId') activityId: string,
    @Param('versionId') versionId: string,
  ): Promise<RopaVersionResponseDto> {
    const updated = await this.service.returnToDraft(actor, activityId, versionId);
    return toVersionDto(updated);
  }

  @Post('activities/:activityId/versions/:versionId/publish')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async publish(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('activityId') activityId: string,
    @Param('versionId') versionId: string,
  ): Promise<RopaVersionResponseDto> {
    const updated = await this.service.publish(actor, activityId, versionId);
    return toVersionDto(updated);
  }

  @Post('activities/:activityId/new-version')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async newVersion(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('activityId') activityId: string,
  ): Promise<RopaVersionResponseDto> {
    const created = await this.service.newVersion(actor, activityId);
    return toVersionDto(created);
  }
}
