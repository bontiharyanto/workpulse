import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { ConsentService } from './consent.service';
import {
  AcceptConsentDto,
  PrivacyPolicyDto,
  UserConsentDto,
  UserConsentListResponseDto,
} from './dto/consent.dto';
import { AllowPendingConsent } from '../auth/decorators/allow-pending-consent.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';


/**
 * Self-service consent endpoints (Fase 31c). Both live under `/me`
 * so the FE's existing per-user API prefix rules apply.
 *
 * `@AllowPendingConsent` opts the route out of the global
 * `ConsentAcceptedGuard` — otherwise `POST /me/consent` would 403
 * for the exact users who need it.
 */
@ApiTags('privacy')
@Controller({ path: 'me/consent', version: '1' })
export class ConsentController {
  constructor(private readonly service: ConsentService) {}

  @Get('current')
  @ApiBearerAuth()
  @AllowPendingConsent()
  @ApiOkResponse({
    type: PrivacyPolicyDto,
    description: 'Current active policy for the tenant, or 204 if none exists.',
  })
  async currentPolicy(@CurrentUser() user: AuthenticatedUser): Promise<PrivacyPolicyDto | null> {
    const policy = await this.service.getLatestForCompany(user.companyId);
    if (!policy) return null;
    return {
      id: policy.id,
      companyId: policy.companyId,
      version: policy.version,
      title: policy.title,
      body: policy.body,
      effectiveAt: policy.effectiveAt.toISOString(),
      publishedById: policy.publishedById,
      createdAt: policy.createdAt.toISOString(),
    };
  }

  @Post()
  @ApiBearerAuth()
  @AllowPendingConsent()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOkResponse({ type: UserConsentDto })
  async accept(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AcceptConsentDto,
    @Req() req: Request,
  ): Promise<UserConsentDto> {
    const row = await this.service.accept(user.id, user.companyId, dto.policyId, {
      ip: req.ip,
      userAgent: req.get('user-agent') ?? null,
    });
    // Re-read for the policy label so we can return a self-contained DTO.
    const policy = await this.service.getLatestForCompany(user.companyId);
    return {
      id: row.id,
      policyId: row.policyId,
      policyVersion: policy?.version ?? '',
      policyTitle: policy?.title ?? '',
      acceptedAt: row.acceptedAt.toISOString(),
      ip: row.ip,
      userAgent: row.userAgent,
    };
  }

  @Get('history')
  @ApiBearerAuth()
  @ApiOkResponse({ type: UserConsentListResponseDto })
  async history(@CurrentUser() user: AuthenticatedUser): Promise<UserConsentListResponseDto> {
    const rows = await this.service.listUserConsents(user.id);
    return {
      items: rows.map((r) => ({
        id: r.id,
        policyId: r.policyId,
        policyVersion: r.policy.version,
        policyTitle: r.policy.title,
        acceptedAt: r.acceptedAt.toISOString(),
        ip: r.ip,
        userAgent: r.userAgent,
      })),
    };
  }
}
