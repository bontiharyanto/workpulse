import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

import { ConsentService } from './consent.service';
import {
  PrivacyPolicyDto,
  PrivacyPolicyListResponseDto,
  PublishPolicyDto,
} from './dto/consent.dto';

/**
 * Admin surface for tenant-wide privacy-policy versions (Fase 31c).
 * Publish a new version → next login prompts every non-consenting
 * user to accept it.
 */
@ApiTags('privacy')
@Controller({ path: 'admin/privacy/policies', version: '1' })
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class ConsentAdminController {
  constructor(private readonly service: ConsentService) {}

  @Get()
  @ApiBearerAuth()
  @ApiOkResponse({ type: PrivacyPolicyListResponseDto })
  async list(
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PrivacyPolicyListResponseDto> {
    const rows = await this.service.listForCompany(actor.companyId);
    return {
      items: rows.map((p) => ({
        id: p.id,
        companyId: p.companyId,
        version: p.version,
        title: p.title,
        body: p.body,
        effectiveAt: p.effectiveAt.toISOString(),
        publishedById: p.publishedById,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiCreatedResponse({ type: PrivacyPolicyDto })
  async publish(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: PublishPolicyDto,
  ): Promise<PrivacyPolicyDto> {
    const row = await this.service.publish(
      { id: actor.id, companyId: actor.companyId, role: actor.role },
      {
        version: dto.version,
        title: dto.title,
        body: dto.body,
        effectiveAt: dto.effectiveAt ? new Date(dto.effectiveAt) : undefined,
      },
    );
    return {
      id: row.id,
      companyId: row.companyId,
      version: row.version,
      title: row.title,
      body: row.body,
      effectiveAt: row.effectiveAt.toISOString(),
      publishedById: row.publishedById,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
