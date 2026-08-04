import { IsOptional, IsString, Length } from 'class-validator';

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;
}
