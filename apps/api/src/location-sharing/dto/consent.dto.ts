import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsString, Length, ValidateIf } from 'class-validator';

export enum ConsentAction {
  OPT_IN = 'OPT_IN',
  OPT_OUT = 'OPT_OUT',
}

/**
 * Body for `PATCH /me/location-sharing/consent`. When opting in,
 * the caller MUST echo the exact SHA-256 of the consent copy they
 * saw — the server rejects with `CONSENT_COPY_STALE` if the SHA
 * doesn't match `LOCATION_SHARING_CONSENT_COPY.id`.
 *
 * This is what closes the "user consented to something they didn't
 * actually see" loophole — the SHA is the checksum of the wording
 * displayed in the FE modal.
 */
export class UpdateLocationSharingConsentDto {
  @ApiProperty({ enum: ConsentAction })
  @IsEnum(ConsentAction)
  action!: ConsentAction;

  @ApiPropertyOptional({ description: 'SHA-256 hex digest of the consent copy shown to the user. Required iff action=OPT_IN.', minLength: 64, maxLength: 64 })
  @ValidateIf((o: UpdateLocationSharingConsentDto) => o.action === ConsentAction.OPT_IN)
  @IsString()
  @Length(64, 64)
  consentCopySha?: string;
}

/**
 * `GET /me/location-sharing` response. Drives the FE's consent
 * card — the FE compares `consentedCopySha` vs `currentCopySha`
 * to detect that the user's opt-in has gone stale after a Legal
 * copy revision.
 */
export class LocationSharingSelfStatusDto {
  @ApiProperty({ description: 'SecurityPolicy.locationSharingEnabled for the tenant.' })
  tenantEnabled!: boolean;

  @ApiProperty({ description: 'User.isFieldWorker — HR eligibility toggle.' })
  eligible!: boolean;

  @ApiProperty({ nullable: true, description: 'Non-null iff currently opted in.' })
  consentedAt!: string | null;

  @ApiProperty({ nullable: true })
  consentedCopySha!: string | null;

  @ApiProperty({ description: 'Current copy SHA. Differs from consentedCopySha when Legal has revised.' })
  currentCopySha!: string;
}
