import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsNumber, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class SubmitOvertimeDto {
  @ApiProperty({ example: '2026-08-01', description: 'Calendar date YYYY-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'workDate must be YYYY-MM-DD' })
  @IsISO8601({ strict: false })
  workDate!: string;

  @ApiProperty({ example: 2.5, description: 'Hours worked overtime. Max 2 decimals.' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(12)
  hours!: number;

  @ApiProperty({ minLength: 3, maxLength: 1000 })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}
