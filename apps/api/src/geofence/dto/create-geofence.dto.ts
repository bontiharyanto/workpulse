import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateGeofenceDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  @IsInt()
  @Min(5)
  @Max(5000)
  radiusMeters!: number;

  /**
   * Reject clock-in when the client's reported `accuracyMeters` is
   * worse than this. `null` = no accuracy check (legacy default).
   */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(10)
  @Max(500)
  maxAccuracyMeters?: number | null;

  /**
   * Wi-Fi SSID allow-list. Empty (default) disables the fallback.
   * A clock-in that reports one of these SSIDs is accepted even if
   * the geofence distance check would otherwise reject it — used
   * for indoor GPS-hostile buildings.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(1, 64, { each: true })
  allowedSsids?: string[];

  /**
   * Cap on the "fuzzy radius" leeway granted per clock-in based on
   * device-reported GPS accuracy. The server computes
   * `effectiveRadius = radiusMeters + min(accuracyMeters, maxLeewayMeters)`.
   * Default `50` m accommodates typical indoor drift; set `0` to
   * restore the strict circle-membership check. Range [0, 500].
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  maxLeewayMeters?: number;
}
