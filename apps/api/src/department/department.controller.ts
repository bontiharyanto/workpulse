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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

import { DepartmentService } from './department.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import type { DepartmentResponseDto } from './dto/department-response.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@ApiTags('admin · departments')
@Controller('admin/departments')
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class DepartmentController {
  constructor(private readonly service: DepartmentService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser): Promise<DepartmentResponseDto[]> {
    return this.service.list(actor);
  }

  @Get(':id')
  get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<DepartmentResponseDto> {
    return this.service.get(actor, id);
  }

  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateDepartmentDto,
  ): Promise<DepartmentResponseDto> {
    return this.service.create(actor, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateDepartmentDto,
  ): Promise<DepartmentResponseDto> {
    return this.service.update(actor, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.remove(actor, id);
  }
}
