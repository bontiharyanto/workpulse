import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

const CAL_DATE = /^\d{4}-\d{2}-\d{2}$/u;
export type ReportFormatLiteral = 'xlsx' | 'pdf';

export class AttendanceReportRequestDto {
  @IsIn(['xlsx', 'pdf'])
  format!: ReportFormatLiteral;

  @Matches(CAL_DATE, { message: 'startDate must be YYYY-MM-DD' })
  startDate!: string;

  @Matches(CAL_DATE, { message: 'endDate must be YYYY-MM-DD' })
  endDate!: string;

  @IsOptional()
  @IsString()
  departmentId?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  userIds?: string[];
}
