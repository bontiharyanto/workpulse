import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { RETENTION_BOUNDS } from '../retention.service';

export class RetentionPolicyDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty()
  notificationRetentionDays!: number;

  @ApiProperty()
  dataExportArchiveRetentionHours!: number;

  @ApiProperty()
  terminatedUserAnonymizeDays!: number;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({ nullable: true })
  updatedById!: string | null;
}

export class UpdateRetentionPolicyDto {
  @ApiProperty({
    required: false,
    description: `Delete notifications older than N days. 0 disables. Range ${RETENTION_BOUNDS.notification.min}–${RETENTION_BOUNDS.notification.max}.`,
  })
  @IsOptional()
  @IsInt()
  @Min(RETENTION_BOUNDS.notification.min)
  @Max(RETENTION_BOUNDS.notification.max)
  notificationRetentionDays?: number;

  @ApiProperty({
    required: false,
    description: `Hours a completed data export archive lives before the DSAR sweep purges it. Range ${RETENTION_BOUNDS.dataExport.min}–${RETENTION_BOUNDS.dataExport.max}.`,
  })
  @IsOptional()
  @IsInt()
  @Min(RETENTION_BOUNDS.dataExport.min)
  @Max(RETENTION_BOUNDS.dataExport.max)
  dataExportArchiveRetentionHours?: number;

  @ApiProperty({
    required: false,
    description: `Auto-anonymise users whose termination is older than N days. 0 disables. Range ${RETENTION_BOUNDS.terminatedUser.min}–${RETENTION_BOUNDS.terminatedUser.max}.`,
  })
  @IsOptional()
  @IsInt()
  @Min(RETENTION_BOUNDS.terminatedUser.min)
  @Max(RETENTION_BOUNDS.terminatedUser.max)
  terminatedUserAnonymizeDays?: number;
}
