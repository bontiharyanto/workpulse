import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Query parameters for `GET /admin/audit-log`. All fields are optional;
 * omitting everything returns the newest page for the caller's tenant.
 *
 * `from`/`to` accept ISO 8601 strings and are transformed to `Date` at
 * validation time so the service consumes a `Date` uniformly.
 */
export class AuditLogQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter by AuditLog.entityType. Case-sensitive exact match (e.g. `LeaveRequest`, `AttendanceRecord`, `Company`).',
    example: 'LeaveRequest',
  })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional({
    description:
      'Filter by AuditLog.entityId (exact match). Requires entityType to be selective on the index.',
  })
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiPropertyOptional({
    description: 'Filter by AuditLog.actorId (User.id).',
  })
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiPropertyOptional({
    description: 'Filter by AuditLog.action (e.g. `LEAVE_REQUEST_APPROVED`).',
    example: 'LEAVE_REQUEST_APPROVED',
  })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({
    description:
      'Inclusive lower bound on createdAt (ISO 8601). Combine with `to` for a range query.',
    example: '2026-07-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  @Transform(({ value }) => (typeof value === 'string' ? new Date(value) : value))
  from?: Date;

  @ApiPropertyOptional({
    description: 'Inclusive upper bound on createdAt (ISO 8601).',
    example: '2026-08-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  @Transform(({ value }) => (typeof value === 'string' ? new Date(value) : value))
  to?: Date;

  @ApiPropertyOptional({
    description:
      "Opaque cursor from a previous response's `nextCursor`. Omit to start at the newest row.",
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Page size. Server enforces [1, 100]; default 25.',
    example: 25,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
