import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Cross-tenant summary of a Company for SUPER_ADMIN. Payroll / overtime
 * config is deliberately excluded — HR modifies those via `/admin/company`.
 */
export class CompanyAdminDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty({
    description: 'ISO-8601 UTC. Present only when the tenant is soft-deleted.',
    nullable: true,
    type: 'string',
    example: null,
  })
  deletedAt!: string | null;
  @ApiProperty({ example: 5, description: 'Non-deleted user count as of the query time.' })
  userCount!: number;
  @ApiProperty({ example: 2, description: 'Non-deleted department count as of the query time.' })
  departmentCount!: number;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

/**
 * Response for `POST /admin/companies` — includes the initial HR user
 * (with the one-time temp password) so the operator can hand credentials
 * to the new tenant during onboarding.
 */
export class CompanyBootstrapDto {
  @ApiProperty({ type: CompanyAdminDto })
  company!: CompanyAdminDto;

  @ApiProperty({ example: 'usr_...' })
  hrUserId!: string;

  @ApiProperty({ example: 'hr@acme.com' })
  hrEmail!: string;

  @ApiProperty({ example: 'Sarah HR' })
  hrFullName!: string;

  @ApiProperty({
    example: 'Cw9-yKzD!m3PVa',
    description:
      'One-time temporary password — the caller MUST display this once and MUST NOT log it. `mustChangePassword=true` forces rotation on first login.',
  })
  temporaryPassword!: string;

  @ApiPropertyOptional({
    example: ['ANNUAL', 'SICK', 'PERSONAL'],
    description: 'LeaveType codes seeded for the new tenant.',
    type: [String],
  })
  seededLeaveTypeCodes?: string[];
}
