import { IsBoolean, IsIn, IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';

const LEAVE_KINDS = [
  'ANNUAL',
  'SICK',
  'PERSONAL',
  'MATERNITY',
  'PATERNITY',
  'UNPAID',
  'OTHER',
] as const;
export type LeaveKindLiteral = (typeof LEAVE_KINDS)[number];

export class CreateLeaveTypeDto {
  @IsString()
  @Matches(/^[A-Z0-9_]{2,30}$/u, {
    message: 'code must be UPPERCASE letters/digits/underscore, 2–30 characters',
  })
  code!: string;

  @IsString()
  @Length(2, 120)
  name!: string;

  @IsIn(LEAVE_KINDS)
  kind!: LeaveKindLiteral;

  @IsInt()
  @Min(0)
  @Max(365)
  defaultAnnualQuota!: number;

  @IsInt()
  @Min(0)
  @Max(365)
  carryOverMax!: number;

  @IsBoolean()
  requiresAttachment!: boolean;
}
