import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Wire shape for `GET /admin/security/policy` and the response of
 * `PATCH /admin/security/policy`. Mirrors
 * `SecurityPolicyDto` in `@workpulse/shared-types` — keep in sync.
 */
export class SecurityPolicyDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty({
    description:
      'When true, HR_MANAGER and SUPER_ADMIN users in this tenant are forced through /setup-mfa on their next request. See ADR-0017.',
  })
  mfaEnforceHighPrivileged!: boolean;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({ nullable: true })
  updatedById!: string | null;
}

/**
 * PATCH body. Every field optional so callers can flip one toggle
 * without echoing the rest.
 */
export class UpdateSecurityPolicyDto {
  @ApiProperty({
    required: false,
    description:
      'Force MFA enrollment for HR_MANAGER + SUPER_ADMIN. Flipping to `true` will 403 those users on the next non-whitelisted route until they finish `/setup-mfa`.',
  })
  @IsOptional()
  @IsBoolean()
  mfaEnforceHighPrivileged?: boolean;
}
