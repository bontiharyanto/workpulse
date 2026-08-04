import { IsOptional, IsString, Length, Matches } from 'class-validator';

const CAL_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export class UpdateHolidayDto {
  @IsOptional()
  @Matches(CAL_DATE, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;
}
