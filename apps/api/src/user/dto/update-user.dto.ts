import { IsIn, IsOptional, IsString, Length } from 'class-validator';

import { USER_ROLES, type UserRole } from '../../common/types/user-role';

const EMPLOYMENT_STATUSES = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  fullName?: string;

  @IsOptional()
  @IsIn(USER_ROLES)
  role?: UserRole;

  @IsOptional()
  @IsString()
  departmentId?: string | null;

  @IsOptional()
  @IsString()
  supervisorId?: string | null;

  @IsOptional()
  @IsIn(EMPLOYMENT_STATUSES)
  employmentStatus?: EmploymentStatus;
}
