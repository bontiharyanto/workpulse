import { ApiProperty } from '@nestjs/swagger';

/**
 * Server-authoritative response DTO for `GET /admin/company` and the return
 * value of `PATCH /admin/company`. All Decimal columns are serialised as
 * `number` (the client never sees Prisma's Decimal type) and `null` is
 * preserved for the base hourly rate when unconfigured.
 */
export class CompanyConfigDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ example: 'Asia/Jakarta' }) timezone!: string;

  @ApiProperty({ nullable: true, description: 'null = not configured' })
  overtimeHourlyRate!: number | null;

  @ApiProperty() overtimeWeekdayMultiplier!: number;
  @ApiProperty() overtimeWeekendMultiplier!: number;
  @ApiProperty() overtimeHolidayMultiplier!: number;
  @ApiProperty() overtimeMaxHoursPerDay!: number;
  @ApiProperty() overtimeSubmitWindowDays!: number;
  @ApiProperty() overtimeCompleteGraceDays!: number;

  @ApiProperty({
    nullable: true,
    example: '2026-07-31',
    description:
      'Inclusive payroll cutoff (YYYY-MM-DD). Attendance mutations at or before this date are refused for HR; SUPER_ADMIN may still override. null = no cutoff.',
  })
  payrollLockedUntil!: string | null;
}
