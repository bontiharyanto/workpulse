import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import type { LeaveKindLiteral } from './create-leave-type.dto';

const LEAVE_KINDS = [
  'ANNUAL',
  'SICK',
  'PERSONAL',
  'MATERNITY',
  'PATERNITY',
  'UNPAID',
  'OTHER',
] as const;

export class UpdateLeaveTypeDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsIn(LEAVE_KINDS)
  kind?: LeaveKindLiteral;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  defaultAnnualQuota?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  carryOverMax?: number;

  @IsOptional()
  @IsBoolean()
  requiresAttachment?: boolean;
}
