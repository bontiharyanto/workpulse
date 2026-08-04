import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DpiaRiskLevel, DpiaStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Fase 31e — DPIA request DTOs.
 *
 * The tight `Length` bounds prevent both no-input DPIAs (regulator would
 * reject a one-word "scope") and megabyte-sized text-bombs (a DPO
 * pasting a whole policy into the necessity field would break the PDF
 * renderer's page flow).
 */

export class CreateDpiaAssessmentDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  ropaActivityId!: string;

  @ApiProperty({ minLength: 4, maxLength: 200 })
  @Transform(trim)
  @IsString()
  @Length(4, 200)
  title!: string;

  @ApiProperty({ minLength: 20, maxLength: 4000 })
  @Transform(trim)
  @IsString()
  @Length(20, 4000)
  scope!: string;

  @ApiProperty({ minLength: 20, maxLength: 4000 })
  @Transform(trim)
  @IsString()
  @Length(20, 4000)
  necessity!: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 4000)
  dpoOpinion?: string;
}

export class UpdateDpiaAssessmentDto {
  @ApiPropertyOptional({ minLength: 4, maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(4, 200)
  title?: string;

  @ApiPropertyOptional({ minLength: 20, maxLength: 4000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(20, 4000)
  scope?: string;

  @ApiPropertyOptional({ minLength: 20, maxLength: 4000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(20, 4000)
  necessity?: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 4000)
  dpoOpinion?: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 4000)
  conclusion?: string;
}

export class CreateDpiaRiskItemDto {
  @ApiProperty({ minLength: 4, maxLength: 200 })
  @Transform(trim)
  @IsString()
  @Length(4, 200)
  title!: string;

  @ApiProperty({ minLength: 10, maxLength: 4000 })
  @Transform(trim)
  @IsString()
  @Length(10, 4000)
  description!: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  likelihood!: number;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  impact!: number;

  @ApiProperty({ minLength: 10, maxLength: 4000 })
  @Transform(trim)
  @IsString()
  @Length(10, 4000)
  mitigations!: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  residualLikelihood!: number;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  residualImpact!: number;
}

export class UpdateDpiaRiskItemDto {
  @ApiPropertyOptional({ minLength: 4, maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(4, 200)
  title?: string;

  @ApiPropertyOptional({ minLength: 10, maxLength: 4000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(10, 4000)
  description?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  likelihood?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  impact?: number;

  @ApiPropertyOptional({ minLength: 10, maxLength: 4000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(10, 4000)
  mitigations?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  residualLikelihood?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  residualImpact?: number;
}

/** Response DTOs — plain interfaces, no validation decorators. */

export interface DpiaRiskItemResponseDto {
  id: string;
  ordinal: number;
  title: string;
  description: string;
  likelihood: number;
  impact: number;
  inherentScore: number;
  inherentLevel: DpiaRiskLevel;
  mitigations: string;
  residualLikelihood: number;
  residualImpact: number;
  residualScore: number;
  residualLevel: DpiaRiskLevel;
  createdAt: string;
  updatedAt: string;
}

export interface DpiaAssessmentResponseDto {
  id: string;
  companyId: string;
  ropaActivityId: string;
  status: DpiaStatus;
  title: string;
  scope: string;
  necessity: string;
  dpoOpinion: string | null;
  conclusion: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedById: string | null;
  reviewedAt: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  archivedAt: string | null;
  riskItems: DpiaRiskItemResponseDto[];
  summaryResidualLevel: DpiaRiskLevel;
}

export interface DpiaAssessmentListItemDto {
  id: string;
  ropaActivityId: string;
  ropaActivitySlug: string;
  ropaActivityName: string | null;
  status: DpiaStatus;
  title: string;
  summaryResidualLevel: DpiaRiskLevel;
  riskItemCount: number;
  updatedAt: string;
}
