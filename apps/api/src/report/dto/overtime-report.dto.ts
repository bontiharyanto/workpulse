import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

import type { ReportFormatLiteral } from './attendance-report.dto';

const CAL_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export type OvertimeStatusLiteral =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'COMPLETED'
  | 'CANCELLED';

const STATUSES: OvertimeStatusLiteral[] = [
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'COMPLETED',
  'CANCELLED',
];

export class OvertimeReportRequestDto {
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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsIn(STATUSES, { each: true })
  statuses?: OvertimeStatusLiteral[];
}
