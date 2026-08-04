import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/**
 * Fase 31d — HTTP DTOs for the ROPA registry.
 *
 * Kept separate from the domain (`RopaVersionPatch` / `RopaVersionCreate`)
 * because class-validator metadata does not belong on domain types. The
 * service converts DTOs → domain shapes.
 */

/** Aligns with the Prisma `RopaLegalBasis` enum. Duplicated as a
 *  `class-validator`-friendly array so we don't ship Prisma internals
 *  through class-transformer reflection. */
const LEGAL_BASIS_VALUES = [
  'CONTRACT',
  'CONSENT',
  'LEGAL_OBLIGATION',
  'LEGITIMATE_INTEREST',
  'VITAL_INTEREST',
  'PUBLIC_TASK',
] as const;

export type RopaLegalBasisDto = (typeof LEGAL_BASIS_VALUES)[number];

// -----------------------------------------------------------------------------
// Requests
// -----------------------------------------------------------------------------

export class CreateRopaActivityDto {
  @IsString()
  @Length(2, 64)
  slug!: string;

  @IsString()
  @Length(2, 200)
  name!: string;

  @IsString()
  @Length(4, 2000)
  purpose!: string;

  @IsIn(LEGAL_BASIS_VALUES)
  legalBasis!: RopaLegalBasisDto;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  legalBasisDetail?: string | null;

  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  dataCategories!: string[];

  @IsArray()
  @ArrayMaxSize(16)
  @IsString({ each: true })
  subjectCategories!: string[];

  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  recipients!: string[];

  @IsString()
  @Length(2, 500)
  retentionPeriod!: string;

  @IsBoolean()
  crossBorderTransfer!: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  crossBorderDetail?: string | null;

  @IsString()
  @Length(2, 2000)
  securityMeasures!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

/** Every field is optional — only present fields are patched. */
export class UpdateRopaVersionDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(4, 2000)
  purpose?: string;

  @IsOptional()
  @IsIn(LEGAL_BASIS_VALUES)
  legalBasis?: RopaLegalBasisDto;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  legalBasisDetail?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  dataCategories?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16)
  @IsString({ each: true })
  subjectCategories?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  recipients?: string[];

  @IsOptional()
  @IsString()
  @Length(2, 500)
  retentionPeriod?: string;

  @IsOptional()
  @IsBoolean()
  crossBorderTransfer?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  crossBorderDetail?: string | null;

  @IsOptional()
  @IsString()
  @Length(2, 2000)
  securityMeasures?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

// -----------------------------------------------------------------------------
// Responses
// -----------------------------------------------------------------------------

export interface RopaVersionResponseDto {
  id: string;
  activityId: string;
  version: number;
  status: 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';
  name: string;
  purpose: string;
  legalBasis: RopaLegalBasisDto;
  legalBasisDetail: string | null;
  dataCategories: string[];
  subjectCategories: string[];
  recipients: string[];
  retentionPeriod: string;
  crossBorderTransfer: boolean;
  crossBorderDetail: string | null;
  securityMeasures: string;
  notes: string | null;

  createdById: string | null;
  createdAt: string;
  reviewedById: string | null;
  reviewedAt: string | null;
  publishedById: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
}

export interface RopaActivityListItemDto {
  activityId: string;
  slug: string;
  currentVersion: RopaVersionResponseDto | null;
  draftVersion: RopaVersionResponseDto | null;
  reviewVersion: RopaVersionResponseDto | null;
}

export interface RopaActivityDetailDto {
  activityId: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  currentVersionId: string | null;
  versions: RopaVersionResponseDto[];
}

export interface SeedRopaResponseDto {
  created: string[];
  skipped: string[];
}
