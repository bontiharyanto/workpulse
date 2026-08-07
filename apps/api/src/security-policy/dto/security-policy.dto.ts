import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

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

  @ApiProperty({
    description:
      'ADR-0041 master switch. Flipping to `true` requires an APPROVED DpiaAssessment (activity=LOCATION_SHARING) — see the PATCH shape.',
  })
  locationSharingEnabled!: boolean;

  @ApiProperty({ nullable: true, description: 'First time the flag was flipped on.' })
  locationSharingEnabledAt!: string | null;

  @ApiProperty({ nullable: true })
  locationSharingEnabledById!: string | null;

  @ApiProperty({ nullable: true })
  locationSharingDpiaId!: string | null;

  @ApiProperty({ nullable: true, description: 'SHA-256 hex digest of the tenant-approved consent copy at flip time.' })
  locationSharingConsentCopySha!: string | null;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({ nullable: true })
  updatedById!: string | null;
}

/**
 * Nested body for the location-sharing toggle in
 * `UpdateSecurityPolicyDto`. Discriminated on `action` — ENABLE
 * requires the DPIA id + consent copy SHA; DISABLE is a bare
 * toggle.
 *
 * class-validator can't express Zod's discriminated union directly,
 * so the ENABLE-only fields are conditionally required via
 * `@ValidateIf`. The Zod schema in `@workpulse/shared-types` is the
 * authoritative contract; this DTO mirrors it.
 */
export enum LocationSharingAction {
  ENABLE = 'ENABLE',
  DISABLE = 'DISABLE',
}

export class UpdateSecurityPolicyLocationSharingDto {
  @ApiProperty({ enum: LocationSharingAction })
  @IsEnum(LocationSharingAction)
  action!: LocationSharingAction;

  @ApiPropertyOptional({ description: 'DpiaAssessment.id — required iff action=ENABLE. Must be APPROVED for activity=LOCATION_SHARING.' })
  @ValidateIf((o: UpdateSecurityPolicyLocationSharingDto) => o.action === LocationSharingAction.ENABLE)
  @IsString()
  dpiaId?: string;

  @ApiPropertyOptional({ description: 'SHA-256 hex digest (64 chars) of the consent copy the tenant approved.' })
  @ValidateIf((o: UpdateSecurityPolicyLocationSharingDto) => o.action === LocationSharingAction.ENABLE)
  @IsString()
  @Length(64, 64)
  consentCopySha?: string;
}

/**
 * PATCH body. Every field optional so callers can flip one toggle
 * without echoing the rest.
 */
export class UpdateSecurityPolicyDto {
  @ApiPropertyOptional({
    description:
      'Force MFA enrollment for HR_MANAGER + SUPER_ADMIN. Flipping to `true` will 403 those users on the next non-whitelisted route until they finish `/setup-mfa`.',
  })
  @IsOptional()
  @IsBoolean()
  mfaEnforceHighPrivileged?: boolean;

  @ApiPropertyOptional({ type: () => UpdateSecurityPolicyLocationSharingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateSecurityPolicyLocationSharingDto)
  locationSharing?: UpdateSecurityPolicyLocationSharingDto;
}
