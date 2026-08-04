import { IsEmail, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

import { USER_ROLES, type UserRole } from '../../common/types/user-role';

export class CreateUserDto {
  @IsEmail()
  @Length(3, 255)
  email!: string;

  @IsString()
  @Length(2, 200)
  fullName!: string;

  @IsIn(USER_ROLES)
  role!: UserRole;

  @IsOptional()
  @IsString()
  departmentId?: string | null;

  @IsOptional()
  @IsString()
  supervisorId?: string | null;

  @Matches(/^\d{4}-\d{2}-\d{2}$/u, { message: 'hiredAt must be a YYYY-MM-DD calendar date' })
  hiredAt!: string;
}
