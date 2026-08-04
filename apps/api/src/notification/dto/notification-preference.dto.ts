import { ApiProperty } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  ValidateNested,
} from 'class-validator';

/**
 * One update in a bulk-upsert payload. Callers should send only the
 * types they actually want to change — omitted types keep their
 * existing values (or defaults if no row exists).
 *
 * Mandatory types (e.g. `PASSWORD_RESET`) are silently dropped by the
 * service. Passing them here is not an error — the FE never sends
 * them, but a hand-crafted request stays graceful.
 */
export class NotificationPreferenceUpdateItemDto {
  @ApiProperty({
    enum: NotificationType,
    example: 'LEAVE_APPROVED_HR',
    description:
      'The notification type this override applies to. Sending an unknown enum value returns 400.',
  })
  @IsEnum(NotificationType)
  type!: NotificationType;

  @ApiProperty({ example: false, description: 'Enable email delivery for this type.' })
  @IsBoolean()
  emailEnabled!: boolean;

  @ApiProperty({ example: true, description: 'Enable in-app delivery for this type.' })
  @IsBoolean()
  inAppEnabled!: boolean;
}

export class UpdateNotificationPreferencesDto {
  @ApiProperty({
    type: [NotificationPreferenceUpdateItemDto],
    description:
      'Batch of overrides. Ordering has no meaning; duplicate types are deduped last-write-wins by the service.',
  })
  @IsArray()
  // Cap the payload — |NotificationType| is currently 15, so 32 is a
  // generous ceiling even after we add a few more event types. Keeps
  // a hand-crafted denial-of-service payload from spinning through a
  // large batch of upserts.
  @ArrayMaxSize(32)
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceUpdateItemDto)
  updates!: NotificationPreferenceUpdateItemDto[];
}

/** Response row — one per known NotificationType. */
export class NotificationPreferenceRowDto {
  @ApiProperty({ enum: NotificationType })
  type!: NotificationType;

  @ApiProperty()
  emailEnabled!: boolean;

  @ApiProperty()
  inAppEnabled!: boolean;

  @ApiProperty({
    description:
      'When true the two toggles are locked (mandatory type). The FE should render them as read-only.',
  })
  mandatory!: boolean;
}
