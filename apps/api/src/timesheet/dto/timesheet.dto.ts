import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  TimesheetEntryKind,
  TimesheetExportFormat,
  TimesheetExportMode,
  TimesheetPeriodType,
  TimesheetStatus,
  WeekStartDay,
} from '@prisma/client';

import { TIMESHEET_CONFIG_BOUNDS } from '../timesheet-config.service';

// ---------------------- Config ----------------------

export class TimesheetConfigDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty({ enum: TimesheetPeriodType })
  periodType!: TimesheetPeriodType;

  @ApiProperty({ enum: WeekStartDay })
  weekStartDay!: WeekStartDay;

  @ApiProperty({ nullable: true, description: 'YYYY-MM-DD' })
  biweeklyAnchor!: string | null;

  @ApiProperty({ nullable: true, description: '1..28' })
  cutoffDayOfMonth!: number | null;

  @ApiProperty()
  timezone!: string;

  // ---- Fase 32f scheduler knobs (surfaced read-only on the DTO) ----
  @ApiProperty({ description: 'Auto-generate next period on cron tick.' })
  autoGenerateEnabled!: boolean;

  @ApiProperty({ description: 'Master switch for reminder notifications.' })
  reminderEnabled!: boolean;

  @ApiProperty({ description: 'Days after periodEnd before first submit nudge.' })
  submitReminderStartDays!: number;

  @ApiProperty({ description: 'Days after periodEnd we stop nudging employees.' })
  submitReminderMaxDays!: number;

  @ApiProperty({ description: 'Days after periodEnd before first approver nudge.' })
  approvalReminderStartDays!: number;

  @ApiProperty({ description: 'Days after periodEnd we stop nudging approvers.' })
  approvalReminderMaxDays!: number;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({ nullable: true })
  updatedById!: string | null;
}

export class UpdateTimesheetConfigDto {
  @ApiProperty({ enum: TimesheetPeriodType, required: false })
  @IsOptional()
  @IsEnum(TimesheetPeriodType)
  periodType?: TimesheetPeriodType;

  @ApiProperty({ enum: WeekStartDay, required: false })
  @IsOptional()
  @IsEnum(WeekStartDay)
  weekStartDay?: WeekStartDay;

  @ApiProperty({ required: false, nullable: true, description: 'YYYY-MM-DD' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'biweeklyAnchor must match YYYY-MM-DD',
  })
  biweeklyAnchor?: string | null;

  @ApiProperty({ required: false, nullable: true, description: '1..28' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(TIMESHEET_CONFIG_BOUNDS.cutoffDayOfMonth.min)
  @Max(TIMESHEET_CONFIG_BOUNDS.cutoffDayOfMonth.max)
  cutoffDayOfMonth?: number | null;

  @ApiProperty({ required: false, description: 'IANA timezone' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  autoGenerateEnabled?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  reminderEnabled?: boolean;

  @ApiProperty({
    required: false,
    description: 'Days after periodEnd before first submit nudge. 0..30.',
  })
  @IsOptional()
  @IsInt()
  @Min(TIMESHEET_CONFIG_BOUNDS.submitReminderStartDays.min)
  @Max(TIMESHEET_CONFIG_BOUNDS.submitReminderStartDays.max)
  submitReminderStartDays?: number;

  @ApiProperty({
    required: false,
    description: 'Days after periodEnd we stop nudging employees. 1..60.',
  })
  @IsOptional()
  @IsInt()
  @Min(TIMESHEET_CONFIG_BOUNDS.submitReminderMaxDays.min)
  @Max(TIMESHEET_CONFIG_BOUNDS.submitReminderMaxDays.max)
  submitReminderMaxDays?: number;

  @ApiProperty({
    required: false,
    description: 'Days after periodEnd before first approver nudge. 0..30.',
  })
  @IsOptional()
  @IsInt()
  @Min(TIMESHEET_CONFIG_BOUNDS.approvalReminderStartDays.min)
  @Max(TIMESHEET_CONFIG_BOUNDS.approvalReminderStartDays.max)
  approvalReminderStartDays?: number;

  @ApiProperty({
    required: false,
    description: 'Days after periodEnd we stop nudging approvers. 1..60.',
  })
  @IsOptional()
  @IsInt()
  @Min(TIMESHEET_CONFIG_BOUNDS.approvalReminderMaxDays.min)
  @Max(TIMESHEET_CONFIG_BOUNDS.approvalReminderMaxDays.max)
  approvalReminderMaxDays?: number;
}

// ---------------------- Generate ----------------------

export class GenerateTimesheetDto {
  @ApiProperty({
    required: false,
    description:
      'ISO 8601 instant used to select the period to (re)generate. Defaults to now.',
  })
  @IsOptional()
  @IsISO8601()
  at?: string;
}

export class GenerateTimesheetResponseDto {
  @ApiProperty()
  periodId!: string;

  @ApiProperty()
  timesheetsGenerated!: number;

  @ApiProperty({
    description:
      'Users whose timesheet in this period is already APPROVED and was left untouched.',
  })
  timesheetsSkippedApproved!: number;
}

// ---------------------- Timesheet view ----------------------

export class TimesheetUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ nullable: true })
  departmentName!: string | null;
}

export class TimesheetTotalsDto {
  @ApiProperty()
  regularHours!: number;

  @ApiProperty()
  overtimeHours!: number;

  @ApiProperty()
  leaveDays!: number;

  @ApiProperty()
  absentDays!: number;

  @ApiProperty()
  holidays!: number;

  @ApiProperty()
  workingDays!: number;

  @ApiProperty()
  lateMinutes!: number;

  @ApiProperty()
  earlyLeaveMinutes!: number;
}

export class TimesheetEntryDto {
  @ApiProperty({ description: 'YYYY-MM-DD' })
  workDate!: string;

  @ApiProperty({ enum: TimesheetEntryKind })
  kind!: TimesheetEntryKind;

  @ApiProperty({ nullable: true })
  expectedHours!: number | null;

  @ApiProperty()
  regularHours!: number;

  @ApiProperty()
  overtimeHours!: number;

  @ApiProperty()
  leaveHours!: number;

  @ApiProperty()
  lateMinutes!: number;

  @ApiProperty()
  earlyLeaveMinutes!: number;

  @ApiProperty({ nullable: true })
  note!: string | null;
}

export class TimesheetSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  periodId!: string;

  @ApiProperty({ description: 'YYYY-MM-DD' })
  periodStart!: string;

  @ApiProperty({ description: 'YYYY-MM-DD' })
  periodEnd!: string;

  @ApiProperty()
  periodLabel!: string;

  @ApiProperty({ type: TimesheetUserDto })
  @Type(() => TimesheetUserDto)
  user!: TimesheetUserDto;

  @ApiProperty({ type: TimesheetTotalsDto })
  @Type(() => TimesheetTotalsDto)
  totals!: TimesheetTotalsDto;

  @ApiProperty()
  generatedAt!: string;

  @ApiProperty({ enum: TimesheetStatus })
  status!: TimesheetStatus;

  @ApiProperty({ nullable: true })
  submittedAt!: string | null;

  @ApiProperty({ nullable: true })
  rejectionReason!: string | null;

  // Fase 32g — reopen provenance surfaced so the queue/detail view
  // can badge "was reopened N times, last on <date> by <name>".
  @ApiProperty({ description: 'Total reopen events for this row.' })
  reopenCount!: number;

  @ApiProperty({ nullable: true })
  lastReopenedAt!: string | null;

  @ApiProperty({ nullable: true })
  lastReopenReason!: string | null;
}

export class TimesheetViewDto extends TimesheetSummaryDto {
  @ApiProperty({ type: [TimesheetEntryDto] })
  @Type(() => TimesheetEntryDto)
  entries!: TimesheetEntryDto[];

  @ApiProperty({ nullable: true })
  supervisorNote!: string | null;

  @ApiProperty({ nullable: true })
  hrManagerNote!: string | null;
}

export class TimesheetListDto {
  @ApiProperty({ type: [TimesheetSummaryDto] })
  @Type(() => TimesheetSummaryDto)
  items!: TimesheetSummaryDto[];

  @ApiProperty()
  total!: number;
}

// ---------------------- Period listing ----------------------

export class TimesheetPeriodDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'YYYY-MM-DD' })
  periodStart!: string;

  @ApiProperty({ description: 'YYYY-MM-DD' })
  periodEnd!: string;

  @ApiProperty()
  label!: string;
}

export class TimesheetPeriodListDto {
  @ApiProperty({ type: [TimesheetPeriodDto] })
  @Type(() => TimesheetPeriodDto)
  items!: TimesheetPeriodDto[];
}

// ---------------------- Workflow (Fase 32b) ----------------------

export type TimesheetDecideAction =
  | 'SUPERVISOR_APPROVE'
  | 'SUPERVISOR_REJECT'
  | 'HR_APPROVE'
  | 'HR_REJECT';

const decideActionValues = [
  'SUPERVISOR_APPROVE',
  'SUPERVISOR_REJECT',
  'HR_APPROVE',
  'HR_REJECT',
] as const;

export class DecideTimesheetDto {
  @ApiProperty({ enum: decideActionValues })
  @IsEnum(decideActionValues as unknown as Record<string, string>)
  action!: TimesheetDecideAction;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Required when the action is a REJECT — surfaced to the employee.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

// ---------------------- Reopen (Fase 32g) ----------------------

export class ReopenTimesheetDto {
  @ApiProperty({
    description:
      'Mandatory reason surfaced to the timesheet owner + supervisor and stored in the immutable audit log. 10..500 characters after trim.',
    minLength: 10,
    maxLength: 500,
  })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class ReopenTimesheetResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: TimesheetStatus })
  status!: TimesheetStatus;

  @ApiProperty({ description: 'Total reopen events for this timesheet, including the one just fired.' })
  reopenCount!: number;
}

export class AdminTimesheetListQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  periodId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiProperty({ required: false, enum: TimesheetStatus })
  @IsOptional()
  @IsEnum(TimesheetStatus)
  status?: TimesheetStatus;
}

// ---------------------- Export (Fase 32c) ----------------------

export class ExportTimesheetDto {
  @ApiProperty({ description: 'Target period id' })
  @IsString()
  periodId!: string;

  @ApiProperty({ enum: TimesheetExportFormat })
  @IsEnum(TimesheetExportFormat)
  format!: TimesheetExportFormat;

  @ApiProperty({ enum: TimesheetExportMode })
  @IsEnum(TimesheetExportMode)
  mode!: TimesheetExportMode;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  departmentId?: string | null;

  @ApiProperty({ required: false, nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string | null;
}

export class TimesheetExportRowDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ enum: TimesheetExportFormat })
  format!: TimesheetExportFormat;

  @ApiProperty({ enum: TimesheetExportMode })
  mode!: TimesheetExportMode;

  @ApiProperty()
  rowCount!: number;

  @ApiProperty()
  entryCount!: number;

  @ApiProperty()
  bytes!: number;

  @ApiProperty()
  payloadSha256!: string;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty()
  period!: {
    id: string;
    label: string;
    periodStart: string;
    periodEnd: string;
  };

  @ApiProperty({ nullable: true })
  departmentName!: string | null;

  @ApiProperty()
  requestedBy!: { id: string; fullName: string; email: string };
}

export class TimesheetExportListDto {
  @ApiProperty({ type: [TimesheetExportRowDto] })
  @Type(() => TimesheetExportRowDto)
  items!: TimesheetExportRowDto[];
}

// ---------------------- Share (Fase 32d) ----------------------

export class CreateExportShareDto {
  @ApiProperty({
    required: false,
    description: 'Lifetime in hours; default TIMESHEET_EXPORT_SHARE_TTL_HOURS, capped 1..168.',
    minimum: 1,
    maximum: 168,
  })
  @IsOptional()
  ttlHours?: number;

  @ApiProperty({ required: false, nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string | null;
}

export class ExportShareUrlDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  url!: string;

  @ApiProperty()
  expiresAt!: string;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class ExportShareRowDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  expiresAt!: string;

  @ApiProperty({ nullable: true })
  revokedAt!: string | null;

  @ApiProperty()
  downloadCount!: number;

  @ApiProperty({ nullable: true })
  lastDownloadedAt!: string | null;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty()
  createdBy!: { id: string; fullName: string; email: string };

  @ApiProperty({ nullable: true })
  revokedBy!: { id: string; fullName: string; email: string } | null;

  @ApiProperty()
  active!: boolean;
}

export class ExportShareListDto {
  @ApiProperty({ type: [ExportShareRowDto] })
  @Type(() => ExportShareRowDto)
  items!: ExportShareRowDto[];
}
