import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Payload for `POST /attendance/corrections`.
 *
 * Shape rules (validated here); business rules ("at least one time",
 * "workDate <= today", "not before hiredAt", "no overlap with existing
 * correction") live in `AttendanceCorrectionService.submit`.
 */
export class SubmitCorrectionDto {
  @ApiProperty({
    description: 'Calendar date (UTC, YYYY-MM-DD) the correction applies to.',
    example: '2026-08-01',
  })
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'INVALID_DATE' })
  workDate!: string;

  @ApiPropertyOptional({
    description:
      'Requested clock-in time (ISO 8601 UTC). Nullable — the correction may target just clock-out. At least one of clockIn/clockOut is required at the service layer.',
    example: '2026-08-01T09:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  requestedClockInAt?: string;

  @ApiPropertyOptional({
    description:
      'Requested clock-out time (ISO 8601 UTC). Nullable — the correction may target just clock-in.',
    example: '2026-08-01T18:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  requestedClockOutAt?: string;

  @ApiProperty({
    description: 'Reason / context for the correction. 5 – 500 characters.',
    example: 'Lupa clock-in karena rapat pagi mendadak.',
  })
  @IsString()
  @MinLength(5, { message: 'REASON_TOO_SHORT' })
  @MaxLength(500, { message: 'REASON_TOO_LONG' })
  reason!: string;

  @ApiPropertyOptional({
    description:
      'S3 attachment key returned by `POST /attachments/presign` (categorized under `attendance-correction`).',
    example: 'attachments/attendance-correction/{companyId}/{userId}/{uuid}.jpg',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  attachmentKey?: string;
}
