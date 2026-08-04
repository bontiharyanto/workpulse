import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * `GET /admin/companies` query params.
 *
 * We use offset pagination here (not keyset) because the total number of
 * tenants is bounded by license (thousands, not millions) and the admin UI
 * benefits from stable page indexes.
 */
export class ListCompaniesQuery {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({
    description: 'When `true`, include soft-deleted tenants in the result.',
    default: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeDeleted?: boolean = false;

  @ApiPropertyOptional({
    description: 'Case-insensitive contains match on `name` or `slug`.',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
