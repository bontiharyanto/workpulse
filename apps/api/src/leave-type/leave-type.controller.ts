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

import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import type { AdminLeaveTypeDto } from './dto/leave-type-response.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { LeaveTypeService } from './leave-type.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

@ApiTags('admin · leave-types')
@Controller('admin/leave-types')
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class LeaveTypeController {
  constructor(private readonly service: LeaveTypeService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser): Promise<AdminLeaveTypeDto[]> {
    return this.service.list(actor);
  }

  @Get(':id')
  get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<AdminLeaveTypeDto> {
    return this.service.get(actor, id);
  }

  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateLeaveTypeDto,
  ): Promise<AdminLeaveTypeDto> {
    return this.service.create(actor, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateLeaveTypeDto,
  ): Promise<AdminLeaveTypeDto> {
    return this.service.update(actor, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.service.remove(actor, id);
  }
}
