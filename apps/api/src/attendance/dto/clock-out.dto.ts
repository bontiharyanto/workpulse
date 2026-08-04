import { ApiProperty } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ClockOutDto {
  @ApiProperty({ example: -6.2088 })
  @IsLatitude()
  latitude!: number;

  @ApiProperty({ example: 106.8456 })
  @IsLongitude()
  longitude!: number;

  @ApiProperty({ example: 8 })
  @IsNumber()
  @Min(0)
  @Max(10_000)
  accuracyMeters!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
