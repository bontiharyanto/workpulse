import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

import { BulkImportHolidaysDto } from './dto/bulk-import.dto';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import type { BulkImportHolidaysResponseDto, HolidayResponseDto } from './dto/holiday-response.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';
import { HolidayService } from './holiday.service';

@ApiTags('admin · holidays')
@Controller('admin/holidays')
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class HolidayController {
  constructor(private readonly service: HolidayService) {}

  @Get()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('year', new DefaultValuePipe(0), ParseIntPipe) yearRaw: number,
  ): Promise<HolidayResponseDto[]> {
    const year = yearRaw > 0 ? yearRaw : undefined;
    return this.service.list(actor, year);
  }

  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateHolidayDto,
  ): Promise<HolidayResponseDto> {
    return this.service.create(actor, body);
  }

  @Post('bulk')
  bulk(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: BulkImportHolidaysDto,
  ): Promise<BulkImportHolidaysResponseDto> {
    return this.service.bulkImport(actor, body.items);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateHolidayDto,
  ): Promise<HolidayResponseDto> {
    return this.service.update(actor, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.service.remove(actor, id);
  }
}
