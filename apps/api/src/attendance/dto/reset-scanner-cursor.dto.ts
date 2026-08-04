import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Payload for `POST /attendance/scanner/reset-cursor`.
 */
export class ResetScannerCursorDto {
  @ApiPropertyOptional({
    description:
      'When true, immediately run a tenant-scoped scan after the cursor reset. Defaults to false — callers who only want to clear the cursor (and let the hourly cron pick it up naturally) should omit this.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  triggerRescan?: boolean;
}

class ResetRescanSkippedDto {
  @ApiProperty({ example: 0 }) INACTIVE!: number;
  @ApiProperty({ example: 0 }) NOT_HIRED_YET!: number;
  @ApiProperty({ example: 0 }) WEEKEND!: number;
  @ApiProperty({ example: 0 }) HOLIDAY!: number;
  @ApiProperty({ example: 0 }) NO_SHIFT_ASSIGNMENT!: number;
  @ApiProperty({ example: 0 }) CLOCKED_IN!: number;
  @ApiProperty({ example: 0 }) ON_APPROVED_LEAVE!: number;
  @ApiProperty({ example: 0 }) ALREADY_MARKED!: number;
  @ApiProperty({ example: 0 }) PAYROLL_LOCKED!: number;
  @ApiProperty({ example: 0 }) ERROR!: number;
}

class RescanResultDto {
  @ApiProperty() companyId!: string;
  @ApiProperty({ example: 3 }) scannedDates!: number;
  @ApiProperty({ example: 4 }) marked!: number;
  @ApiProperty({ type: ResetRescanSkippedDto }) skipped!: ResetRescanSkippedDto;
  @ApiProperty({ example: 128 }) durationMs!: number;
}

export class ResetScannerCursorResponseDto {
  @ApiProperty({
    nullable: true,
    example: '2026-07-31',
    description:
      'Cursor value BEFORE the reset (`Company.lastAbsentScanDate`). `null` when the cursor had never been set.',
  })
  before!: string | null;

  @ApiProperty({
    type: 'string',
    nullable: true,
    example: null,
    description: 'Always `null` — the cursor is cleared to `null` on reset.',
  })
  after!: null;

  @ApiProperty({ example: true }) rescanTriggered!: boolean;

  @ApiPropertyOptional({
    type: RescanResultDto,
    description:
      'Present only when `triggerRescan` was `true`. Same shape as the per-tenant slice of the scheduler run result.',
  })
  rescanResult?: RescanResultDto;
}
