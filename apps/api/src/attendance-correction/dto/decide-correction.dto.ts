import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Payload for `POST /attendance/corrections/:id/decision`.
 */
export class DecideCorrectionDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'], example: 'APPROVE' })
  @IsString()
  @IsIn(['APPROVE', 'REJECT'], { message: 'INVALID_ACTION' })
  action!: 'APPROVE' | 'REJECT';

  @ApiPropertyOptional({
    description:
      'Optional decision note (max 500 chars). Surfaced in the notification to the requester when action = REJECT.',
    example: 'Absensi sudah tercatat lewat sistem — koreksi tidak diperlukan.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
