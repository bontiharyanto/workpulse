import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsObject, IsOptional, IsString, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Fase 33b — DTOs for the custom report builder.
 *
 * We deliberately keep the DTO validation shallow (name + description +
 * arbitrary `definition` object). The actual definition validation
 * lives in the domain layer (`validateDefinition`), which is re-run
 * inside the service on every write. This mirrors how ROPA / DPIA
 * segregate structural check (DTO) from semantic check (domain).
 */

export class PreviewCustomReportDto {
  @ApiProperty()
  @IsObject()
  definition!: Record<string, unknown>;
}

export class CreateSavedReportDto {
  @ApiProperty({ minLength: 3, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(3, 120)
  name!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 500)
  description?: string;

  @ApiProperty()
  @IsObject()
  definition!: Record<string, unknown>;
}

export class UpdateSavedReportDto {
  @ApiPropertyOptional({ minLength: 3, maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 120)
  name?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  definition?: Record<string, unknown>;
}

export interface SavedReportResponseDto {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  definition: unknown;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomReportRowDto {
  key: string;
  label?: string;
  value: number;
}

export interface CustomReportResultDto {
  definition: unknown;
  rows: CustomReportRowDto[];
  totalRows: number;
  computedAt: string;
}
