import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/**
 * Body for `POST /location-sharing/requests` — supervisor asks
 * a specific user for their current location. Mirrors
 * `createLocationShareRequestSchema` in `@workpulse/shared-types`.
 */
export class CreateLocationShareRequestDto {
  @ApiProperty({ description: 'User being asked. Must be `isFieldWorker=true` in the same tenant.' })
  @IsString()
  targetUserId!: string;

  @ApiProperty({
    description:
      'Free-form justification (5–200 chars). Surfaced to the target user on the notification and consent screen — a bare "check" is not acceptable UX. Also lands in the audit log.',
    minLength: 5,
    maxLength: 200,
  })
  @IsString()
  @Length(5, 200)
  reason!: string;
}
