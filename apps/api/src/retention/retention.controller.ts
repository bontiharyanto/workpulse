import { Body, Controller, Get, HttpCode, HttpStatus, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { RetentionPolicy } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

import { RetentionPolicyDto, UpdateRetentionPolicyDto } from './dto/retention.dto';
import { RetentionService } from './retention.service';

/**
 * `/admin/privacy/retention` — HR / Super Admin surface for
 * configuring the tenant's data-retention policy (Fase 31c).
 * Route mounted under the admin path so the FE role gate + JWT
 * guard already apply.
 */
@ApiTags('retention')
@Controller({ path: 'admin/privacy/retention', version: '1' })
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class RetentionController {
  constructor(private readonly service: RetentionService) {}

  @Get()
  @ApiBearerAuth()
  @ApiOkResponse({ type: RetentionPolicyDto })
  async getPolicy(@CurrentUser() actor: AuthenticatedUser): Promise<RetentionPolicyDto> {
    const policy = await this.service.getForCompany(actor.companyId);
    return toDto(policy);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOkResponse({ type: RetentionPolicyDto })
  async updatePolicy(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: UpdateRetentionPolicyDto,
  ): Promise<RetentionPolicyDto> {
    const policy = await this.service.update(
      { id: actor.id, companyId: actor.companyId, role: actor.role },
      body,
    );
    return toDto(policy);
  }
}

function toDto(policy: RetentionPolicy): RetentionPolicyDto {
  return {
    id: policy.id,
    companyId: policy.companyId,
    notificationRetentionDays: policy.notificationRetentionDays,
    dataExportArchiveRetentionHours: policy.dataExportArchiveRetentionHours,
    terminatedUserAnonymizeDays: policy.terminatedUserAnonymizeDays,
    updatedAt: policy.updatedAt.toISOString(),
    updatedById: policy.updatedById,
  };
}
