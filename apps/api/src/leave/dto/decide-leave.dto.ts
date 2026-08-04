import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class DecideLeaveDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] })
  @IsEnum(['APPROVE', 'REJECT'] as const)
  action!: 'APPROVE' | 'REJECT';

  @ApiProperty({ required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
