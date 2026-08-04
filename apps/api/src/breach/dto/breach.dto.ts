import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BreachCategory,
  BreachSeverity,
  BreachStatus,
  BreachTimelineEventType,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

import { DeadlineBucket } from '../domain/deadline';

/**
 * Fase 31g — request DTOs for the breach ledger.
 *
 * Fields are deliberately tight — regulator-facing exports need
 * clean payloads. Free-form narrative fields are bounded to prevent
 * XSS-via-huge-string and to keep the PDF renderer's page flow
 * predictable. Timestamp fields accept ISO-8601 and `class-transformer`
 * coerces to `Date` before validation.
 */

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateBreachIncidentDto {
  @ApiProperty({ minLength: 4, maxLength: 200 })
  @Transform(trim)
  @IsString()
  @Length(4, 200)
  title!: string;

  @ApiProperty({ minLength: 20, maxLength: 5000 })
  @Transform(trim)
  @IsString()
  @Length(20, 5000)
  description!: string;

  @ApiProperty({ enum: BreachSeverity })
  @IsEnum(BreachSeverity)
  severity!: BreachSeverity;

  @ApiProperty({ enum: BreachCategory })
  @IsEnum(BreachCategory)
  category!: BreachCategory;

  @ApiProperty({ type: String, format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  detectedAt!: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  occurredAt?: Date;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  affectedUserCount?: number;

  @ApiPropertyOptional({ isArray: true, type: String, maxItems: 30 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  affectedDataCategories?: string[];

  @ApiPropertyOptional({ isArray: true, type: String, maxItems: 30 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  affectedSystems?: string[];

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 5000)
  containmentActions?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignedToId?: string;
}

export class UpdateBreachIncidentDto {
  @ApiPropertyOptional({ minLength: 4, maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(4, 200)
  title?: string;

  @ApiPropertyOptional({ minLength: 20, maxLength: 5000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(20, 5000)
  description?: string;

  @ApiPropertyOptional({ enum: BreachSeverity })
  @IsOptional()
  @IsEnum(BreachSeverity)
  severity?: BreachSeverity;

  @ApiPropertyOptional({ enum: BreachCategory })
  @IsOptional()
  @IsEnum(BreachCategory)
  category?: BreachCategory;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  occurredAt?: Date;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  affectedUserCount?: number;

  @ApiPropertyOptional({ isArray: true, type: String, maxItems: 30 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  affectedDataCategories?: string[];

  @ApiPropertyOptional({ isArray: true, type: String, maxItems: 30 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  affectedSystems?: string[];

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 5000)
  containmentActions?: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 5000)
  rootCause?: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 5000)
  remediation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignedToId?: string;
}

export class NotifyAuthorityDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  notifiedAt!: Date;

  @ApiProperty({ minLength: 1, maxLength: 200 })
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  authorityRef!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 2000)
  note?: string;
}

export class NotifySubjectsDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  notifiedAt!: Date;

  @ApiProperty({ minLength: 20, maxLength: 5000 })
  @Transform(trim)
  @IsString()
  @Length(20, 5000)
  template!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 2000)
  note?: string;
}

export class CloseBreachDto {
  @ApiProperty({ minLength: 20, maxLength: 5000 })
  @Transform(trim)
  @IsString()
  @Length(20, 5000)
  postMortemSummary!: string;
}

export class AppendBreachNoteDto {
  @ApiProperty({ minLength: 4, maxLength: 4000 })
  @Transform(trim)
  @IsString()
  @Length(4, 4000)
  note!: string;
}

// -------- Response shapes -----------------------------------------

export interface BreachTimelineEventDto {
  id: string;
  eventType: BreachTimelineEventType;
  note: string;
  metadata: Record<string, unknown> | null;
  actorId: string | null;
  actorEmail: string | null;
  occurredAt: string;
}

export interface BreachIncidentResponseDto {
  id: string;
  companyId: string;
  title: string;
  description: string;
  severity: BreachSeverity;
  category: BreachCategory;
  status: BreachStatus;
  detectedAt: string;
  occurredAt: string | null;
  containedAt: string | null;
  authorityNotifiedAt: string | null;
  subjectsNotifiedAt: string | null;
  closedAt: string | null;
  affectedUserCount: number;
  affectedDataCategories: string[];
  affectedSystems: string[];
  containmentActions: string;
  rootCause: string | null;
  remediation: string | null;
  authorityNotificationRef: string | null;
  subjectNotificationTemplate: string | null;
  reportedById: string;
  reportedByEmail: string | null;
  assignedToId: string | null;
  assignedToEmail: string | null;
  createdAt: string;
  updatedAt: string;
  deadline: {
    deadlineAt: string;
    hoursRemaining: number;
    bucket: DeadlineBucket;
    overdue: boolean;
    active: boolean;
  };
  timeline: BreachTimelineEventDto[];
}

export interface BreachIncidentListItemDto {
  id: string;
  title: string;
  severity: BreachSeverity;
  category: BreachCategory;
  status: BreachStatus;
  detectedAt: string;
  authorityNotifiedAt: string | null;
  affectedUserCount: number;
  deadline: {
    deadlineAt: string;
    hoursRemaining: number;
    bucket: DeadlineBucket;
    overdue: boolean;
    active: boolean;
  };
  reportedByEmail: string | null;
  assignedToEmail: string | null;
  updatedAt: string;
}
