import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * `PATCH /admin/companies/:id` — SUPER_ADMIN updates a tenant's identity
 * fields. This does NOT touch tenant-scoped config (overtime / payroll) —
 * that flow lives on `/admin/company` (singular) so HR can self-serve.
 */
export class UpdateCompanyDto {
  @ApiPropertyOptional({ example: 'Acme Corporation 2' })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;

  @ApiPropertyOptional({ example: 'acme-2' })
  @IsOptional()
  @IsString()
  @Length(2, 40)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug must contain only lowercase letters, digits, and hyphens',
  })
  slug?: string;

  @ApiPropertyOptional({ example: 'Asia/Makassar' })
  @IsOptional()
  @IsString()
  timezone?: string;
}
