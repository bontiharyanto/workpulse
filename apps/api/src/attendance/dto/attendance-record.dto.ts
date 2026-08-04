import { ApiProperty } from '@nestjs/swagger';
import type { AttendanceStatus } from '@prisma/client';

export class AttendanceRecordDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() shiftId!: string;
  @ApiProperty() workDate!: string;
  @ApiProperty() clockInAt!: string;
  @ApiProperty({ nullable: true }) clockOutAt!: string | null;
  @ApiProperty() clockInLatitude!: number;
  @ApiProperty() clockInLongitude!: number;
  @ApiProperty({ nullable: true }) clockOutLatitude!: number | null;
  @ApiProperty({ nullable: true }) clockOutLongitude!: number | null;
  @ApiProperty({ enum: ['ON_TIME', 'LATE', 'EARLY_LEAVE', 'ABSENT', 'ON_LEAVE'] })
  status!: AttendanceStatus;
  @ApiProperty() lateMinutes!: number;
  @ApiProperty() earlyLeaveMinutes!: number;
}
