import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AttendanceCorrectionStatus } from '@prisma/client';

/**
 * DTO surface for a single AttendanceCorrection row. All Date fields are
 * serialized to ISO 8601 strings by the controller layer; the FE deserializes
 * via the shared-types Zod schema.
 */
export class CorrectionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiPropertyOptional() userFullName?: string;
  @ApiProperty({ example: '2026-08-01' }) workDate!: string;
  @ApiProperty({ nullable: true }) requestedClockInAt!: string | null;
  @ApiProperty({ nullable: true }) requestedClockOutAt!: string | null;
  @ApiProperty() reason!: string;
  @ApiProperty({
    nullable: true,
    description:
      'Presigned GET URL — freshly minted on each response so links are short-lived. `null` when no attachment was provided or storage is disabled.',
  })
  attachmentUrl!: string | null;
  @ApiProperty({
    enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED'],
  })
  status!: AttendanceCorrectionStatus;
  @ApiProperty({ nullable: true }) supervisorId!: string | null;
  @ApiProperty({ nullable: true }) decidedById!: string | null;
  @ApiProperty({ nullable: true }) decidedAt!: string | null;
  @ApiProperty({ nullable: true }) decisionNote!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
