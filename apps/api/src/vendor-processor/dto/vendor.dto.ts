import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VendorCategory, VendorDataVolume, VendorStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDate,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * Fase 31f — Vendor / Processor Register request DTOs.
 *
 * Free-form narrative fields are bounded so the register stays
 * printable in the PDF export and to prevent XSS-via-huge-string.
 * Timestamp fields accept ISO-8601 and `class-transformer` coerces
 * to `Date` before validation.
 */

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const nullOrTrim = ({ value }: { value: unknown }): unknown => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? null : t;
};

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export class CreateVendorDto {
  @ApiProperty({ minLength: 2, maxLength: 64, example: 'payroll-nusantara' })
  @Transform(trim)
  @IsString()
  @Length(2, 64)
  @Matches(SLUG_RE, { message: 'slug must be kebab-case' })
  slug!: string;

  @ApiProperty({ minLength: 2, maxLength: 200 })
  @Transform(trim)
  @IsString()
  @Length(2, 200)
  name!: string;

  @ApiProperty({ enum: VendorCategory })
  @IsEnum(VendorCategory)
  category!: VendorCategory;

  @ApiProperty({ minLength: 10, maxLength: 4000 })
  @Transform(trim)
  @IsString()
  @Length(10, 4000)
  description!: string;

  @ApiPropertyOptional({ type: [String], maxItems: 32 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @ArrayUnique()
  @IsString({ each: true })
  dataCategories?: string[];

  @ApiPropertyOptional({ enum: VendorDataVolume, default: 'LOW' })
  @IsOptional()
  @IsEnum(VendorDataVolume)
  personalDataVolume?: VendorDataVolume;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(nullOrTrim)
  @IsString()
  @Length(1, 200)
  dataResidency?: string | null;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(nullOrTrim)
  @IsString()
  @Length(1, 200)
  contactName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(nullOrTrim)
  @IsEmail()
  contactEmail?: string | null;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @Transform(nullOrTrim)
  @IsString()
  @Length(1, 64)
  contactPhone?: string | null;

  @ApiPropertyOptional({ maxLength: 2048 })
  @IsOptional()
  @Transform(nullOrTrim)
  @IsString()
  @Length(1, 2048)
  contractDocumentUrl?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  contractStartAt?: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  contractEndAt?: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dpaSignedAt?: Date | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  subprocessorsAllowed?: boolean;

  @ApiPropertyOptional({ type: [String], maxItems: 16 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16)
  @ArrayUnique()
  @IsString({ each: true })
  securityCertifications?: string[];

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  nextReviewAt?: Date;
}

export class UpdateVendorDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 200)
  name?: string;

  @ApiPropertyOptional({ enum: VendorCategory })
  @IsOptional()
  @IsEnum(VendorCategory)
  category?: VendorCategory;

  @ApiPropertyOptional({ enum: VendorStatus })
  @IsOptional()
  @IsEnum(VendorStatus)
  status?: VendorStatus;

  @ApiPropertyOptional({ minLength: 10, maxLength: 4000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(10, 4000)
  description?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 32 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @ArrayUnique()
  @IsString({ each: true })
  dataCategories?: string[];

  @ApiPropertyOptional({ enum: VendorDataVolume })
  @IsOptional()
  @IsEnum(VendorDataVolume)
  personalDataVolume?: VendorDataVolume;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(nullOrTrim)
  @IsString()
  @Length(1, 200)
  dataResidency?: string | null;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(nullOrTrim)
  @IsString()
  @Length(1, 200)
  contactName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(nullOrTrim)
  @IsEmail()
  contactEmail?: string | null;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @Transform(nullOrTrim)
  @IsString()
  @Length(1, 64)
  contactPhone?: string | null;

  @ApiPropertyOptional({ maxLength: 2048 })
  @IsOptional()
  @Transform(nullOrTrim)
  @IsString()
  @Length(1, 2048)
  contractDocumentUrl?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  contractStartAt?: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  contractEndAt?: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dpaSignedAt?: Date | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  subprocessorsAllowed?: boolean;

  @ApiPropertyOptional({ type: [String], maxItems: 16 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16)
  @ArrayUnique()
  @IsString({ each: true })
  securityCertifications?: string[];

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  nextReviewAt?: Date;
}

export class MarkVendorReviewedDto {
  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @Transform(nullOrTrim)
  @IsString()
  @Length(1, 4000)
  note?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  nextReviewAt?: Date;
}

export class TerminateVendorDto {
  @ApiProperty({ minLength: 5, maxLength: 4000 })
  @Transform(trim)
  @IsString()
  @Length(5, 4000)
  reason!: string;
}

export class LinkRopaDto {
  @ApiProperty()
  @IsString()
  @Length(1, 128)
  ropaActivityId!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(nullOrTrim)
  @IsString()
  @Length(1, 2000)
  note?: string | null;
}

export class ListVendorsQueryDto {
  @ApiPropertyOptional({ enum: VendorStatus })
  @IsOptional()
  @IsEnum(VendorStatus)
  status?: VendorStatus;

  @ApiPropertyOptional({ enum: VendorCategory })
  @IsOptional()
  @IsEnum(VendorCategory)
  category?: VendorCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
