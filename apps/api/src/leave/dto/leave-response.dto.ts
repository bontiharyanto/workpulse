import { ApiProperty } from '@nestjs/swagger';
import type { LeaveKind, LeaveStatus } from '@prisma/client';

export class LeaveRequestDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty({ required: false }) userFullName?: string;
  @ApiProperty() leaveTypeId!: string;
  @ApiProperty() leaveTypeName!: string;
  @ApiProperty({
    enum: ['ANNUAL', 'SICK', 'PERSONAL', 'MATERNITY', 'PATERNITY', 'UNPAID', 'OTHER'],
  })
  leaveTypeKind!: LeaveKind;
  @ApiProperty({
    enum: ['DRAFT', 'PENDING_SUPERVISOR', 'PENDING_HR', 'APPROVED', 'REJECTED', 'CANCELLED'],
  })
  status!: LeaveStatus;
  @ApiProperty({ example: '2026-06-15' }) startDate!: string;
  @ApiProperty({ example: '2026-06-19' }) endDate!: string;
  @ApiProperty() days!: number;
  @ApiProperty() reason!: string;
  @ApiProperty({
    nullable: true,
    description:
      'Short-lived presigned GET URL when the request has an attachment. Regenerated on every read.',
  })
  attachmentUrl!: string | null;
  @ApiProperty({ nullable: true }) supervisorId!: string | null;
  @ApiProperty({ nullable: true }) hrManagerId!: string | null;
  @ApiProperty({ nullable: true }) supervisorAt!: string | null;
  @ApiProperty({ nullable: true }) hrManagerAt!: string | null;
  @ApiProperty({ nullable: true }) supervisorNote!: string | null;
  @ApiProperty({ nullable: true }) hrManagerNote!: string | null;
  @ApiProperty() createdAt!: string;
}

export class LeaveBalanceDto {
  @ApiProperty() leaveTypeId!: string;
  @ApiProperty() leaveTypeCode!: string;
  @ApiProperty() leaveTypeName!: string;
  @ApiProperty({
    enum: ['ANNUAL', 'SICK', 'PERSONAL', 'MATERNITY', 'PATERNITY', 'UNPAID', 'OTHER'],
  })
  kind!: LeaveKind;
  @ApiProperty() year!: number;
  @ApiProperty() quota!: number;
  @ApiProperty() carriedOver!: number;
  @ApiProperty() used!: number;
  @ApiProperty() reserved!: number;
  @ApiProperty() remaining!: number;
}
