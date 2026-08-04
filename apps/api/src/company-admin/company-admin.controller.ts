import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CompanyAdminService } from './company-admin.service';
import { CompanyAdminDto, CompanyBootstrapDto } from './dto/company-admin.dto';
import { CreateCompanyDto } from './dto/create-company.dto';
import { ListCompaniesResponseDto } from './dto/list-companies-response.dto';
import { ListCompaniesQuery } from './dto/list-companies.query';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

/**
 * Cross-tenant company management for platform operators (SUPER_ADMIN).
 *
 * Contrast with `/admin/company` (singular), which is scoped to the caller's
 * OWN tenant and open to HR_MANAGER for self-service payroll/overtime config.
 * This controller intentionally sits on a different path to prevent
 * accidental cross-tenant traversal by mis-configured guards.
 */
@ApiTags('admin · companies')
@ApiBearerAuth()
@Roles('SUPER_ADMIN')
@Controller({ path: 'admin/companies', version: '1' })
@ApiForbiddenResponse({ description: 'SUPER_ADMIN role required.' })
export class CompanyAdminController {
  constructor(private readonly service: CompanyAdminService) {}

  @Get()
  @ApiOperation({ summary: 'List all tenants (paginated).' })
  @ApiOkResponse({ type: ListCompaniesResponseDto })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListCompaniesQuery,
  ): Promise<ListCompaniesResponseDto> {
    return this.service.list(actor, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a single tenant by id.' })
  @ApiOkResponse({ type: CompanyAdminDto })
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string): Promise<CompanyAdminDto> {
    return this.service.get(actor, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a new tenant + bootstrap default leave types + initial HR user (temp password returned once).',
  })
  @ApiCreatedResponse({ type: CompanyBootstrapDto })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateCompanyDto,
  ): Promise<CompanyBootstrapDto> {
    return this.service.create(actor, body);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update tenant identity fields (name / slug / timezone).' })
  @ApiOkResponse({ type: CompanyAdminDto })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateCompanyDto,
  ): Promise<CompanyAdminDto> {
    return this.service.update(actor, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Soft-delete a tenant. Refused when active users remain — deactivate them first via /admin/users.',
  })
  @ApiNoContentResponse()
  async softDelete(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.softDelete(actor, id);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a previously soft-deleted tenant.' })
  @ApiOkResponse({ type: CompanyAdminDto })
  restore(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<CompanyAdminDto> {
    return this.service.restore(actor, id);
  }
}
