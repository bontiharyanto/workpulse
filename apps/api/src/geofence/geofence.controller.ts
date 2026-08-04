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

import { CreateGeofenceDto } from './dto/create-geofence.dto';
import type { GeofenceResponseDto } from './dto/geofence-response.dto';
import { UpdateGeofenceDto } from './dto/update-geofence.dto';
import { GeofenceService } from './geofence.service';

@ApiTags('admin · geofences')
@Controller('admin/geofences')
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class GeofenceController {
  constructor(private readonly service: GeofenceService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser): Promise<GeofenceResponseDto[]> {
    return this.service.list(actor);
  }

  @Get(':id')
  get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<GeofenceResponseDto> {
    return this.service.get(actor, id);
  }

  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateGeofenceDto,
  ): Promise<GeofenceResponseDto> {
    return this.service.create(actor, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateGeofenceDto,
  ): Promise<GeofenceResponseDto> {
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
