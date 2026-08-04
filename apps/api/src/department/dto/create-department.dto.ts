import { IsOptional, IsString, Length } from 'class-validator';

export class CreateDepartmentDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;
}
