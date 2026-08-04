import { ApiProperty } from '@nestjs/swagger';

export class OvertimeRequestDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty({ required: false }) userFullName?: string;
  @ApiProperty({ example: '2026-08-01' }) workDate!: string;
  @ApiProperty() hours!: number;
  @ApiProperty() reason!: string;
  @ApiProperty({
    enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'],
  })
  status!: string;
  @ApiProperty({ enum: ['WEEKDAY', 'WEEKEND', 'HOLIDAY'] }) dayKind!: string;
  @ApiProperty() baseRate!: number;
  @ApiProperty() rateMultiplier!: number;
  @ApiProperty() ratePerHour!: number;
  @ApiProperty() totalAmount!: number;
  @ApiProperty({ nullable: true }) approvedById!: string | null;
  @ApiProperty({ nullable: true }) approvedAt!: string | null;
  @ApiProperty({ nullable: true }) rejectedAt!: string | null;
  @ApiProperty({ nullable: true }) decisionNote!: string | null;
  @ApiProperty() createdAt!: string;
}
