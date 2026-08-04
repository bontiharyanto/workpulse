import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * PATCH input for `/admin/company`. All fields optional — omitted keys mean
 * "keep current value". `overtimeHourlyRate` can be explicitly `null` to
 * clear the tenant-wide default (forcing per-user rate overrides).
 *
 * Semantic bounds (e.g. multiplier ≥ 1 to prevent wage reduction) are
 * enforced here so the service layer receives already-sanitized values.
 */
export class UpdateCompanyConfigDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 120 })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ example: 'Asia/Jakarta' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  timezone?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Base hourly rate; null clears the tenant default.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999_999)
  overtimeHourlyRate?: number | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10)
  overtimeWeekdayMultiplier?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10)
  overtimeWeekendMultiplier?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10)
  overtimeHolidayMultiplier?: number;

  @ApiPropertyOptional({ minimum: 0.01, maximum: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(24)
  overtimeMaxHoursPerDay?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  overtimeSubmitWindowDays?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  overtimeCompleteGraceDays?: number;

  @ApiPropertyOptional({
    nullable: true,
    example: '2026-07-31',
    description:
      'Inclusive payroll cutoff (YYYY-MM-DD). Explicit null clears the cutoff. Omit the field to keep the current value.',
  })
  @IsOptional()
  // `null` explicitly clears the cutoff — skip the format check in that case.
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'INVALID_DATE' })
  payrollLockedUntil?: string | null;
}
