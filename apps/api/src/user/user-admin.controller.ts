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
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import type { AdminUserDto, UserCredentialResponseDto } from './dto/user-response.dto';
import { UserAdminService } from './user-admin.service';

@ApiTags('admin · users')
@Controller('admin/users')
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class UserAdminController {
  constructor(private readonly service: UserAdminService) {}

  @Get()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListUsersQueryDto,
  ): Promise<AdminUserDto[]> {
    return this.service.list(actor, query);
  }

  @Get(':id')
  get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<AdminUserDto> {
    return this.service.get(actor, id);
  }

  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateUserDto,
  ): Promise<UserCredentialResponseDto> {
    return this.service.create(actor, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
  ): Promise<AdminUserDto> {
    return this.service.update(actor, id, body);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<UserCredentialResponseDto> {
    return this.service.resetPassword(actor, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.deactivate(actor, id);
  }
}
