import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export const RETENTION_AUDIT_STATUS = [
  'SUCCESS',
  'GAP_DETECTED',
  'WORKER_INACTIVE',
] as const;
export type RetentionAuditStatusLiteral =
  (typeof RETENTION_AUDIT_STATUS)[number];

export const RETENTION_AUDIT_FINDING_KIND = [
  'notifications_past_retention',
  'dsar_archives_past_retention',
  'terminated_users_past_retention',
  'worker_inactive_during_period',
] as const;
export type RetentionAuditFindingKindLiteral =
  (typeof RETENTION_AUDIT_FINDING_KIND)[number];

export class RetentionAuditFindingDto {
  @ApiProperty({ enum: RETENTION_AUDIT_FINDING_KIND })
  kind!: RetentionAuditFindingKindLiteral;

  @ApiProperty({ enum: ['info', 'warning', 'critical'] })
  severity!: 'info' | 'warning' | 'critical';

  @ApiProperty({ required: false, nullable: true })
  count?: number;

  @ApiProperty()
  message!: string;
}

export class RetentionAuditPolicySnapshotDto {
  @ApiProperty()
  notificationRetentionDays!: number;

  @ApiProperty()
  dataExportArchiveRetentionHours!: number;

  @ApiProperty()
  terminatedUserAnonymizeDays!: number;
}

export class RetentionAuditReportDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty({
    description:
      'Inclusive UTC start of the audit period (first of the month).',
  })
  periodStart!: string;

  @ApiProperty({
    description: 'Exclusive UTC end of the audit period.',
  })
  periodEnd!: string;

  @ApiProperty()
  generatedAt!: string;

  @ApiProperty({ enum: RETENTION_AUDIT_STATUS })
  status!: RetentionAuditStatusLiteral;

  @ApiProperty()
  notificationsPruned!: number;

  @ApiProperty()
  usersAutoAnonymised!: number;

  @ApiProperty()
  dsarArchivesExpired!: number;

  @ApiProperty()
  notificationsPastRetention!: number;

  @ApiProperty()
  dsarArchivesPastRetention!: number;

  @ApiProperty()
  terminatedUsersPastRetention!: number;

  @ApiProperty({ type: RetentionAuditPolicySnapshotDto })
  policySnapshot!: RetentionAuditPolicySnapshotDto;

  @ApiProperty({ required: false, nullable: true })
  workerLastRunAt!: string | null;

  @ApiProperty({ type: [RetentionAuditFindingDto] })
  findings!: RetentionAuditFindingDto[];

  @ApiProperty({ required: false, nullable: true })
  notes!: string | null;
}

export class ListRetentionAuditQueryDto {
  @ApiProperty({ required: false, enum: RETENTION_AUDIT_STATUS })
  @IsOptional()
  @IsEnum(RETENTION_AUDIT_STATUS)
  status?: RetentionAuditStatusLiteral;

  @ApiProperty({ required: false, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, minimum: 1, maximum: 100, default: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class RegenerateRetentionAuditDto {
  @ApiProperty({ minimum: 2000, maximum: 2100 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @ApiProperty({ minimum: 1, maximum: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;
}

export class ListRetentionAuditResponseDto {
  @ApiProperty({ type: [RetentionAuditReportDto] })
  rows!: RetentionAuditReportDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}
