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


import { CreateShiftAssignmentDto, EndShiftAssignmentDto } from './dto/assignment.dto';
import { CreateShiftDto } from './dto/create-shift.dto';
import type { ShiftAssignmentResponseDto, ShiftResponseDto } from './dto/shift-response.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { ShiftService } from './shift.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

@ApiTags('admin · shifts')
@Controller('admin')
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class ShiftController {
  constructor(private readonly service: ShiftService) {}

  // ---------- Shifts ----------

  @Get('shifts')
  listShifts(@CurrentUser() actor: AuthenticatedUser): Promise<ShiftResponseDto[]> {
    return this.service.list(actor);
  }

  @Get('shifts/:id')
  getShift(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ShiftResponseDto> {
    return this.service.get(actor, id);
  }

  @Post('shifts')
  createShift(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateShiftDto,
  ): Promise<ShiftResponseDto> {
    return this.service.create(actor, body);
  }

  @Patch('shifts/:id')
  updateShift(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateShiftDto,
  ): Promise<ShiftResponseDto> {
    return this.service.update(actor, id, body);
  }

  @Delete('shifts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeShift(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.remove(actor, id);
  }

  // ---------- Assignments ----------

  @Get('users/:userId/shift-assignments')
  listUserAssignments(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId') userId: string,
  ): Promise<ShiftAssignmentResponseDto[]> {
    return this.service.listAssignmentsForUser(actor, userId);
  }

  @Post('shifts/:shiftId/assignments')
  createAssignment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('shiftId') shiftId: string,
    @Body() body: CreateShiftAssignmentDto,
  ): Promise<ShiftAssignmentResponseDto> {
    return this.service.createAssignment(actor, shiftId, body);
  }

  @Patch('shift-assignments/:id/end')
  endAssignment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: EndShiftAssignmentDto,
  ): Promise<ShiftAssignmentResponseDto> {
    return this.service.endAssignment(actor, id, body.effectiveTo);
  }

  @Delete('shift-assignments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAssignment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.removeAssignment(actor, id);
  }
}
