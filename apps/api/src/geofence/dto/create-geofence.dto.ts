import { IsInt, IsLatitude, IsLongitude, IsString, Length, Max, Min } from 'class-validator';

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
}
