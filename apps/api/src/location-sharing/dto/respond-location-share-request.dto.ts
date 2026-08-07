import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Discriminated on `outcome`. When `ACCEPT`, the coordinate quad
 * is required; when `DECLINE`, no coordinate data is accepted
 * (the DTO layer strips it — the whole point of DECLINE is
 * "don't send lat/lng").
 *
 * Class-validator can't express Zod-style discriminated unions
 * directly, so we use `@ValidateIf` on each coord field to make
 * them conditionally required based on `outcome`.
 */
export enum RespondOutcome {
  ACCEPT = 'ACCEPT',
  DECLINE = 'DECLINE',
}

export class RespondLocationShareRequestDto {
  @ApiProperty({ enum: RespondOutcome })
  @IsEnum(RespondOutcome)
  outcome!: RespondOutcome;

  @ApiPropertyOptional({ description: 'WGS84 latitude. Required iff outcome=ACCEPT.' })
  @ValidateIf((o: RespondLocationShareRequestDto) => o.outcome === RespondOutcome.ACCEPT)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ description: 'WGS84 longitude. Required iff outcome=ACCEPT.' })
  @ValidateIf((o: RespondLocationShareRequestDto) => o.outcome === RespondOutcome.ACCEPT)
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({
    description:
      'Device-reported GPS accuracy in meters. 0..10000. Stored raw — HR sees it in the raw display so they can assess trust.',
  })
  @ValidateIf((o: RespondLocationShareRequestDto) => o.outcome === RespondOutcome.ACCEPT)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  accuracyMeters?: number;

  @ApiPropertyOptional({
    description:
      'Client wall-clock time at collection (Geolocation.timestamp). Distinct from server receive time; drift is visible to HR.',
  })
  @ValidateIf((o: RespondLocationShareRequestDto) => o.outcome === RespondOutcome.ACCEPT)
  @IsDateString()
  clientCapturedAt?: string;

  @IsOptional()
  neverUsedPassthrough?: unknown;
}
