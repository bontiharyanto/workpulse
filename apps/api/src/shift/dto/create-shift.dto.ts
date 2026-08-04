import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

const SHIFT_TYPES = ['STATIC', 'FLEXIBLE', 'ROTATING'] as const;
export type ShiftTypeLiteral = (typeof SHIFT_TYPES)[number];

const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/u;

export class CreateShiftDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsIn(SHIFT_TYPES)
  type!: ShiftTypeLiteral;

  @Matches(HH_MM_PATTERN, { message: 'startTime must be HH:mm' })
  startTime!: string;

  @Matches(HH_MM_PATTERN, { message: 'endTime must be HH:mm' })
  endTime!: string;

  @IsInt()
  @Min(0)
  @Max(240)
  graceMinutes!: number;

  @IsOptional()
  @IsString()
  geofenceId?: string | null;
}
