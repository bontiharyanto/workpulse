import { IsOptional, IsString, Matches } from 'class-validator';

const CAL_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export class CreateShiftAssignmentDto {
  @IsString()
  userId!: string;

  @Matches(CAL_DATE, { message: 'effectiveFrom must be YYYY-MM-DD' })
  effectiveFrom!: string;

  @IsOptional()
  @Matches(CAL_DATE, { message: 'effectiveTo must be YYYY-MM-DD' })
  effectiveTo?: string | null;
}

export class EndShiftAssignmentDto {
  @Matches(CAL_DATE, { message: 'effectiveTo must be YYYY-MM-DD' })
  effectiveTo!: string;
}
