import { ApiProperty } from '@nestjs/swagger';

import { CompanyAdminDto } from './company-admin.dto';

/**
 * Envelope for `GET /admin/companies`. Total count comes from a separate
 * SELECT COUNT(*) — cheap because Company is small and heavily indexed by
 * (deletedAt, name).
 */
export class ListCompaniesResponseDto {
  @ApiProperty({ type: [CompanyAdminDto] })
  items!: CompanyAdminDto[];

  @ApiProperty({ example: 42 })
  totalCount!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  pageSize!: number;
}
