import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ReportDeliveryStatus,
  ReportFrequency,
  ScheduledReportType,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateReportScheduleDto {
  @ApiProperty({ minLength: 3, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(3, 120)
  name!: string;

  @ApiProperty({
    enum: [
      'TIMESHEET_SUMMARY',
      'ROPA',
      'DPIA',
      'ANALYTICS_SNAPSHOT',
      'CUSTOM',
    ],
  })
  @IsEnum({
    TIMESHEET_SUMMARY: 'TIMESHEET_SUMMARY',
    ROPA: 'ROPA',
    DPIA: 'DPIA',
    ANALYTICS_SNAPSHOT: 'ANALYTICS_SNAPSHOT',
    CUSTOM: 'CUSTOM',
  })
  reportType!: ScheduledReportType;

  /**
   * Required when `reportType === 'CUSTOM'`. Ignored otherwise.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  savedReportId?: string;

  @ApiProperty({ enum: ['DAILY', 'WEEKLY', 'MONTHLY'] })
  @IsEnum({ DAILY: 'DAILY', WEEKLY: 'WEEKLY', MONTHLY: 'MONTHLY' })
  frequency!: ReportFrequency;

  @ApiPropertyOptional({ minimum: 0, maximum: 28 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(28)
  cadenceDay?: number;

  @ApiProperty({ minimum: 0, maximum: 23, default: 6 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  cadenceHour!: number;

  @ApiProperty({ type: [String], minItems: 1, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsEmail({}, { each: true })
  recipients!: string[];
}

export class UpdateReportScheduleDto {
  @ApiPropertyOptional({ minLength: 3, maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 120)
  name?: string;

  @ApiPropertyOptional({ enum: ['DAILY', 'WEEKLY', 'MONTHLY'] })
  @IsOptional()
  @IsEnum({ DAILY: 'DAILY', WEEKLY: 'WEEKLY', MONTHLY: 'MONTHLY' })
  frequency?: ReportFrequency;

  @ApiPropertyOptional({ minimum: 0, maximum: 28 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(28)
  cadenceDay?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 23 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  cadenceHour?: number;

  @ApiPropertyOptional({ type: [String], maxItems: 20 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsEmail({}, { each: true })
  recipients?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

// -------- Response DTOs --------

export interface ReportScheduleResponseDto {
  id: string;
  companyId: string;
  reportType: ScheduledReportType;
  savedReportId: string | null;
  name: string;
  frequency: ReportFrequency;
  cadenceDay: number | null;
  cadenceHour: number;
  active: boolean;
  recipients: readonly string[];
  nextRunAt: string;
  lastRunAt: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportDeliveryResponseDto {
  id: string;
  scheduleId: string;
  status: ReportDeliveryStatus;
  recipients: readonly string[];
  payloadSha256: string | null;
  payloadBytes: number | null;
  attachmentFilename: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  errorSnippet: string | null;
  createdAt: string;
}
