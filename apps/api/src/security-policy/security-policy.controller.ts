import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { SecurityPolicy } from '@prisma/client';

import { LocationSharingAction, SecurityPolicyDto, UpdateSecurityPolicyDto } from './dto/security-policy.dto';
import type { SecurityPolicyLocationSharingAction, SecurityPolicyUpdate } from './security-policy.service';
import { SecurityPolicyService } from './security-policy.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

/**
 * Admin surface for the tenant-scoped `SecurityPolicy` row.
 *
 * Only `SUPER_ADMIN` may read or mutate the policy — HR Manager can
 * see whether MFA is enforced via the auth `me` response but must
 * not be able to relax the tenant's security posture unilaterally.
 * If a customer decides to delegate this, the `Roles` decorator here
 * is the single edit needed (also update ADR-0017 §Ops).
 */
@ApiTags('security')
@Controller({ path: 'admin/security/policy', version: '1' })
@Roles('SUPER_ADMIN')
export class SecurityPolicyController {
  constructor(private readonly service: SecurityPolicyService) {}

  @Get()
  @ApiBearerAuth()
  @ApiOkResponse({ type: SecurityPolicyDto })
  async getPolicy(@CurrentUser() actor: AuthenticatedUser): Promise<SecurityPolicyDto> {
    const policy = await this.service.getForCompany(actor.companyId);
    return toDto(policy);
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOkResponse({ type: SecurityPolicyDto })
  async updatePolicy(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: UpdateSecurityPolicyDto,
  ): Promise<SecurityPolicyDto> {
    const patch: SecurityPolicyUpdate = {};
    if (body.mfaEnforceHighPrivileged !== undefined) {
      patch.mfaEnforceHighPrivileged = body.mfaEnforceHighPrivileged;
    }
    if (body.locationSharing) {
      patch.locationSharing = toLocationSharingAction(body.locationSharing);
    }
    const policy = await this.service.update(
      { id: actor.id, companyId: actor.companyId, role: actor.role },
      patch,
    );
    return toDto(policy);
  }
}

function toLocationSharingAction(
  dto: UpdateSecurityPolicyDto['locationSharing'],
): SecurityPolicyLocationSharingAction | undefined {
  if (!dto) return undefined;
  if (dto.action === LocationSharingAction.ENABLE) {
    return { action: 'ENABLE', dpiaId: dto.dpiaId!, consentCopySha: dto.consentCopySha! };
  }
  return { action: 'DISABLE' };
}

function toDto(policy: SecurityPolicy): SecurityPolicyDto {
  return {
    id: policy.id,
    companyId: policy.companyId,
    mfaEnforceHighPrivileged: policy.mfaEnforceHighPrivileged,
    locationSharingEnabled: policy.locationSharingEnabled,
    locationSharingEnabledAt: policy.locationSharingEnabledAt
      ? policy.locationSharingEnabledAt.toISOString()
      : null,
    locationSharingEnabledById: policy.locationSharingEnabledById,
    locationSharingDpiaId: policy.locationSharingDpiaId,
    locationSharingConsentCopySha: policy.locationSharingConsentCopySha,
    updatedAt: policy.updatedAt.toISOString(),
    updatedById: policy.updatedById,
  };
}
