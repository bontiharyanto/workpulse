import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Query params for `GET /notifications/archive`. All optional. Boolean
 * comes in as `true`/`false`/`1`/`0` in the query string — mirror the
 * bell endpoint's coercion for consistency.
 */
export class NotificationArchiveQueryDto {
  @ApiPropertyOptional({
    description: 'When true, only unread rows are returned.',
    example: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === '1' || value === true)
  @IsBoolean()
  unreadOnly?: boolean;

  @ApiPropertyOptional({
    description: 'Page size. Server clamps to [1, 100]; default 25.',
    example: 25,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description:
      "Opaque cursor from a previous response's `nextCursor`. Omit to start at the newest row.",
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class NotificationArchiveRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() type!: string;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiPropertyOptional({ nullable: true }) data?: unknown;
  @ApiProperty({ nullable: true }) readAt!: string | null;
  @ApiProperty() createdAt!: string;
}

export class NotificationArchivePageDto {
  @ApiProperty({ type: [NotificationArchiveRowDto] })
  rows!: NotificationArchiveRowDto[];

  @ApiProperty({
    nullable: true,
    description:
      "Opaque cursor to pass in the next call's `cursor` param. `null` when there are no more pages.",
  })
  nextCursor!: string | null;
}
