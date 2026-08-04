import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyticsMetricKey } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsIn, IsOptional } from 'class-validator';

import { SUPPORTED_WINDOWS, WindowDays } from '../domain/period';

/**
 * Query params for `/admin/analytics/dashboard`. `windowDays` is
 * coerced from a string via `class-transformer` and constrained to the
 * canonical set so we never render fractional or unbounded ranges.
 */
export class DashboardQueryDto {
  @ApiPropertyOptional({
    description: 'Look-back window length in days. Defaults to 30.',
    enum: SUPPORTED_WINDOWS as unknown as number[],
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(SUPPORTED_WINDOWS as unknown as number[])
  windowDays: WindowDays = 30;
}

/**
 * Query params for `/admin/analytics/timeseries`. Same window contract
 * as the dashboard endpoint, plus a mandatory metric key. Using the
 * Prisma enum here lets NestJS's built-in ValidationPipe reject
 * unknown keys before they hit the service.
 */
export class TimeseriesQueryDto {
  @ApiProperty({ enum: AnalyticsMetricKey })
  @IsEnum(AnalyticsMetricKey)
  metricKey!: AnalyticsMetricKey;

  @ApiPropertyOptional({
    description: 'Look-back window length in days. Defaults to 30.',
    enum: SUPPORTED_WINDOWS as unknown as number[],
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(SUPPORTED_WINDOWS as unknown as number[])
  windowDays: WindowDays = 30;
}

/**
 * Shape returned by `/admin/analytics/dashboard`. Kept as a plain
 * interface (no class-validator decorators) — this is the *response*
 * side, so validation is unnecessary. Mirrored on the FE via a Zod
 * schema exported from `@workpulse/shared-types`.
 */
export interface DashboardTileDto {
  metricKey: AnalyticsMetricKey;
  label: string;
  description: string;
  formatKind: string;
  direction: string;
  fractionDigits: number;
  currentValue: number;
  previousValue: number;
  delta: {
    absolute: number;
    pct: number | null;
    trend: string;
  };
}

export interface DashboardResponseDto {
  window: {
    from: string;
    to: string;
    today: string;
    days: number;
    timezone: string;
  };
  tiles: DashboardTileDto[];
  lastComputedAt: string | null;
}

export interface TimeseriesResponseDto {
  metricKey: AnalyticsMetricKey;
  label: string;
  formatKind: string;
  fractionDigits: number;
  window: {
    from: string;
    to: string;
    today: string;
    days: number;
    timezone: string;
  };
  points: Array<{ date: string; value: number; isToday: boolean }>;
}
