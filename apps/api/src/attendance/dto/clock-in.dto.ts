import { ApiProperty } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

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
}
