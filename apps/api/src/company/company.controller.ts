import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CompanyService } from './company.service';
import { CompanyConfigDto } from './dto/company-config.dto';
import { UpdateCompanyConfigDto } from './dto/update-company-config.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

/**
 * All routes here are tenant-scoped via `actor.companyId` — there is no
 * `/admin/companies/:id` variant by design, so a compromised token cannot
 * accidentally traverse tenants even if the guard misconfigures.
 */
@ApiTags('admin · company')
@ApiBearerAuth()
@Controller({ path: 'admin/company', version: '1' })
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class CompanyController {
  constructor(private readonly service: CompanyService) {}

  @Get()
  @ApiOkResponse({ type: CompanyConfigDto })
  get(@CurrentUser() actor: AuthenticatedUser): Promise<CompanyConfigDto> {
    return this.service.getConfig(actor);
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CompanyConfigDto })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: UpdateCompanyConfigDto,
  ): Promise<CompanyConfigDto> {
    return this.service.updateConfig(actor, body);
  }
}
