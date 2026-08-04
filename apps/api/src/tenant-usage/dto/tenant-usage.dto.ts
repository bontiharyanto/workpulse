import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class TenantUsageSnapshotDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty()
  periodStart!: string;

  @ApiProperty()
  periodEnd!: string;

  @ApiProperty()
  generatedAt!: string;

  // ---- Storage (all in BigInt-safe string form) ----
  @ApiProperty({
    description:
      'Bytes stored across TimesheetExport payloads committed during the period. Rendered as a stringified integer to preserve BigInt precision.',
  })
  storageExportBytes!: string;

  @ApiProperty()
  storageDsarBytes!: string;

  @ApiProperty()
  storageTotalBytes!: string;

  @ApiProperty()
  attachmentBytesTracked!: boolean;

  // ---- DB row counts ----
  @ApiProperty()
  dbRowsUser!: number;
  @ApiProperty()
  dbRowsAttendance!: number;
  @ApiProperty()
  dbRowsLeave!: number;
  @ApiProperty()
  dbRowsOvertime!: number;
  @ApiProperty()
  dbRowsTimesheetEntry!: number;
  @ApiProperty()
  dbRowsAuditLog!: number;
  @ApiProperty()
  dbRowsNotification!: number;
  @ApiProperty()
  dbRowsTimesheetExport!: number;
  @ApiProperty()
  dbRowsWebhookDelivery!: number;
  @ApiProperty()
  dbRowsTotal!: string;

  // ---- Communication ----
  @ApiProperty()
  notificationsCreated!: number;

  @ApiProperty()
  webhookDeliveries!: number;

  // ---- Population ----
  @ApiProperty()
  activeUsers!: number;

  @ApiProperty()
  totalUsers!: number;

  @ApiProperty({ nullable: true, required: false })
  notes!: string | null;
}

export class ListTenantUsageQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiProperty({ required: false, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, minimum: 1, maximum: 200, default: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

export class RegenerateTenantUsageDto {
  @ApiProperty()
  @IsString()
  companyId!: string;

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

export class ListTenantUsageResponseDto {
  @ApiProperty({ type: [TenantUsageSnapshotDto] })
  rows!: TenantUsageSnapshotDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}
