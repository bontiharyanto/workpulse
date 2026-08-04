import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

import type { ShiftTypeLiteral } from './create-shift.dto';

const SHIFT_TYPES = ['STATIC', 'FLEXIBLE', 'ROTATING'] as const;
const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/u;

export class UpdateShiftDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsIn(SHIFT_TYPES)
  type?: ShiftTypeLiteral;

  @IsOptional()
  @Matches(HH_MM_PATTERN, { message: 'startTime must be HH:mm' })
  startTime?: string;

  @IsOptional()
  @Matches(HH_MM_PATTERN, { message: 'endTime must be HH:mm' })
  endTime?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  graceMinutes?: number;

  @IsOptional()
  @IsString()
  geofenceId?: string | null;
}
