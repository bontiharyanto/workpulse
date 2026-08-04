import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import type { ReportFormatLiteral } from './attendance-report.dto';

export class LeaveSummaryReportRequestDto {
  @IsIn(['xlsx', 'pdf'])
  format!: ReportFormatLiteral;

  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @IsOptional()
  @IsString()
  departmentId?: string | null;
}
