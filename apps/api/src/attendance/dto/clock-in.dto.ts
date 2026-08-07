import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ClockInDto {
  @ApiProperty({ example: -6.2088, description: 'WGS84 latitude in degrees' })
  @IsLatitude()
  latitude!: number;

  @ApiProperty({ example: 106.8456, description: 'WGS84 longitude in degrees' })
  @IsLongitude()
  longitude!: number;

  @ApiProperty({ example: 12, description: 'Device-reported GPS accuracy in meters' })
  @IsNumber()
  @Min(0)
  @Max(10_000)
  accuracyMeters!: number;

  @ApiProperty({ required: false, example: 'Working from HQ' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /**
   * Optional Wi-Fi SSID reported by the client. Used as an
   * OR-fallback to the geofence distance check for indoor
   * GPS-hostile buildings: if `Geofence.allowedSsids` contains
   * this value, the clock-in is accepted regardless of distance.
   * Browsers cannot expose SSIDs — only the mobile app supplies
   * this. Always trimmed server-side and case-sensitive.
   */
  @ApiPropertyOptional({ example: 'OFFICE-WIFI-JKT' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  wifiSsid?: string;
}
