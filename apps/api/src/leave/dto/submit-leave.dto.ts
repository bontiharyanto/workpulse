import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class SubmitLeaveDto {
  @ApiProperty() @IsString() leaveTypeId!: string;

  @ApiProperty({ example: '2026-06-15', description: 'Calendar date YYYY-MM-DD (company local calendar)' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be YYYY-MM-DD' })
  @IsISO8601({ strict: false })
  startDate!: string;

  @ApiProperty({ example: '2026-06-19' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate must be YYYY-MM-DD' })
  @IsISO8601({ strict: false })
  endDate!: string;

  @ApiProperty({ minLength: 3, maxLength: 1000 })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;

  @ApiProperty({
    required: false,
    description:
      'S3 object key returned by POST /attachments/presign. Must belong to the requesting user.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  attachmentKey?: string;
}
