import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';

import { USER_ROLES, type UserRole } from '../../common/types/user-role';

const EMPLOYMENT_STATUSES = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED'] as const;

export class ListUsersQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  search?: string;

  @IsOptional()
  @IsIn(USER_ROLES)
  role?: UserRole;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsIn(EMPLOYMENT_STATUSES)
  status?: (typeof EMPLOYMENT_STATUSES)[number];

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  includeInactive?: boolean;
}
