import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

import type { UserRole } from '../../common/types/user-role';

/**
 * Query DTO for `GET /admin/shifts/users/without-active-shift`.
 *
 * Kept intentionally minimal (single optional search string) because the
 * result set is inherently small — one row per user in a tenant that lacks
 * an in-force UserShiftAssignment. If tenants grow past ~1k users we can
 * add pagination without breaking the response shape.
 */
export class ListUsersWithoutShiftQueryDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on email or fullName.',
    example: 'lead@',
  })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  search?: string;
}

/**
 * Response row DTO. Shape matches `userWithoutShiftSchema` in
 * `@workpulse/shared-types` so frontend can `parse` safely.
 */
export class UserWithoutShiftDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty({ enum: ['EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER'] })
  role!: UserRole;

  @ApiProperty({ nullable: true })
  departmentId!: string | null;

  @ApiProperty({ nullable: true })
  departmentName!: string | null;

  @ApiProperty({ nullable: true, example: '2024-06-01' })
  hiredAt!: string | null;
}
