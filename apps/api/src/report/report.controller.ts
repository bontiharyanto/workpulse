import { Body, Controller, Header, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

import { AttendanceReportRequestDto } from './dto/attendance-report.dto';
import { LeaveSummaryReportRequestDto } from './dto/leave-summary-report.dto';
import { OvertimeReportRequestDto } from './dto/overtime-report.dto';
import { ReportService } from './report.service';

@ApiTags('reports')
@Controller('reports')
@Roles('HR_MANAGER', 'SUPER_ADMIN')
// Reports are expensive (large queries + PDF/XLSX serialization). Cap at 5/min
// per client to prevent one user from starving the API.
@Throttle({ default: { limit: 5, ttl: 60_000 } })
export class ReportController {
  constructor(private readonly service: ReportService) {}

  @Post('attendance')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async attendance(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: AttendanceReportRequestDto,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    // Set headers BEFORE the renderer starts streaming — once bytes are written
    // Nest cannot change response headers.
    const filename = `attendance-${body.startDate}_${body.endDate}.${body.format}`;
    res.setHeader('Content-Type', mimeFor(body.format));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await this.service.streamAttendance(actor, body, res);
  }

  @Post('leave-summary')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async leaveSummary(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: LeaveSummaryReportRequestDto,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const filename = `leave-summary-${body.year}.${body.format}`;
    res.setHeader('Content-Type', mimeFor(body.format));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await this.service.streamLeaveSummary(actor, body, res);
  }

  @Post('overtime-summary')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async overtimeSummary(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: OvertimeReportRequestDto,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const filename = `overtime-${body.startDate}_${body.endDate}.${body.format}`;
    res.setHeader('Content-Type', mimeFor(body.format));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await this.service.streamOvertimeSummary(actor, body, res);
  }
}

function mimeFor(format: 'xlsx' | 'pdf'): string {
  return format === 'xlsx'
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'application/pdf';
}
