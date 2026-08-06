import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { SecurityPolicy } from '@prisma/client';

import { SecurityPolicyDto, UpdateSecurityPolicyDto } from './dto/security-policy.dto';
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
    const policy = await this.service.update(
      { id: actor.id, companyId: actor.companyId, role: actor.role },
      body,
    );
    return toDto(policy);
  }
}

function toDto(policy: SecurityPolicy): SecurityPolicyDto {
  return {
    id: policy.id,
    companyId: policy.companyId,
    mfaEnforceHighPrivileged: policy.mfaEnforceHighPrivileged,
    updatedAt: policy.updatedAt.toISOString(),
    updatedById: policy.updatedById,
  };
}
