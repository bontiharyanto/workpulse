import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Payload for `POST /attendance/absence` — HR (or Super Admin) manually
 * marks a user as absent on a specific calendar date.
 *
 * The service layer performs deeper validation (target user exists,
 * belongs to the same tenant, no clock-in on that date, no pre-existing
 * absence). This DTO only validates *shape*.
 */
export class CreateAbsenceDto {
  @ApiProperty({
    description:
      "Target user's id. Must belong to the actor's company. Cross-tenant ids resolve to 404.",
    example: 'ckl9x8...',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{5,60}$/, { message: 'INVALID_USER_ID' })
  userId!: string;

  @ApiProperty({
    description:
      'Calendar date (UTC, YYYY-MM-DD) the user was absent. Must not be in the future.',
    example: '2026-07-30',
  })
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'INVALID_DATE' })
  workDate!: string;

  @ApiProperty({
    required: false,
    description:
      "Free-text audit note (max 500 chars). Stored on the AbsenceRecord — visible in the audit log and to HR when reconciling.",
    example: 'Forgot to file leave request.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
