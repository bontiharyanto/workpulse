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

export class UpdateGeofenceDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(5000)
  radiusMeters?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(10)
  @Max(500)
  maxAccuracyMeters?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(1, 64, { each: true })
  allowedSsids?: string[];
}
