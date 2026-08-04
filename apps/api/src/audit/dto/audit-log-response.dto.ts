import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuditLogRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() action!: string;
  @ApiProperty() entityType!: string;
  @ApiProperty() entityId!: string;
  /** Null when the row was written by a system actor (cron, retention sweep). */
  @ApiProperty({ nullable: true }) actorId!: string | null;
  @ApiProperty({ nullable: true }) actorName!: string | null;
  @ApiProperty({ nullable: true }) actorEmail!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Snapshot of the entity BEFORE the mutation. Shape is action-specific; the FE renders a generic key-by-key diff against `afterJson`.',
  })
  beforeJson!: unknown;
  @ApiPropertyOptional({ nullable: true }) afterJson!: unknown;
  @ApiProperty({ nullable: true }) ip!: string | null;
  @ApiProperty({ nullable: true }) userAgent!: string | null;
  @ApiProperty({ description: 'ISO 8601 timestamp.' }) createdAt!: string;
}

export class AuditLogPageDto {
  @ApiProperty({ type: [AuditLogRowDto] })
  rows!: AuditLogRowDto[];

  @ApiProperty({
    nullable: true,
    description:
      'Opaque cursor to pass in the next call\'s `cursor` param. `null` when there are no more pages.',
  })
  nextCursor!: string | null;
}
