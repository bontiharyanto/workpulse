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
import { Throttle } from '@nestjs/throttler';

import { REPORT_REGISTRY } from './domain/report-registry';
import {
  CreateReportScheduleDto,
  ReportDeliveryResponseDto,
  ReportScheduleResponseDto,
  UpdateReportScheduleDto,
} from './dto/report-schedule.dto';
import { ReportScheduleService } from './report-schedule.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

/**
 * Fase 33c — HR / super-admin controller for report scheduling.
 *
 * All endpoints are tenant-scoped inside the service. Delivery log
 * reads are throttled less aggressively than mutations because DPOs
 * poll the log while debugging a bad-recipient failure.
 */
@ApiTags('admin · report-schedules')
@Controller('admin/reports')
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class ReportScheduleController {
  constructor(private readonly service: ReportScheduleService) {}

  @Get('registry')
  registry() {
    return REPORT_REGISTRY;
  }

  @Get('schedules')
  async list(@CurrentUser() actor: AuthenticatedUser): Promise<ReportScheduleResponseDto[]> {
    const rows = await this.service.list(actor);
    return rows.map(toDto);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('schedules')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateReportScheduleDto,
  ): Promise<ReportScheduleResponseDto> {
    const created = await this.service.create(actor, body);
    return toDto(created);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Patch('schedules/:id')
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateReportScheduleDto,
  ): Promise<ReportScheduleResponseDto> {
    const updated = await this.service.update(actor, id, body);
    return toDto(updated);
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Delete('schedules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.service.remove(actor, id);
  }

  @Get('schedules/:id/deliveries')
  async deliveries(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ReportDeliveryResponseDto[]> {
    const rows = await this.service.listDeliveries(actor, id);
    return rows.map(toDeliveryDto);
  }
}

function toDto(r: {
  id: string;
  companyId: string;
  reportType: string;
  savedReportId: string | null;
  name: string;
  frequency: string;
  cadenceDay: number | null;
  cadenceHour: number;
  active: boolean;
  recipients: string[];
  nextRunAt: Date;
  lastRunAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ReportScheduleResponseDto {
  return {
    id: r.id,
    companyId: r.companyId,
    reportType: r.reportType as ReportScheduleResponseDto['reportType'],
    savedReportId: r.savedReportId,
    name: r.name,
    frequency: r.frequency as ReportScheduleResponseDto['frequency'],
    cadenceDay: r.cadenceDay,
    cadenceHour: r.cadenceHour,
    active: r.active,
    recipients: r.recipients,
    nextRunAt: r.nextRunAt.toISOString(),
    lastRunAt: r.lastRunAt?.toISOString() ?? null,
    createdById: r.createdById,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toDeliveryDto(r: {
  id: string;
  scheduleId: string;
  status: string;
  recipients: string[];
  payloadSha256: string | null;
  payloadBytes: number | null;
  attachmentFilename: string | null;
  attempts: number;
  lastAttemptAt: Date | null;
  deliveredAt: Date | null;
  errorSnippet: string | null;
  createdAt: Date;
}): ReportDeliveryResponseDto {
  return {
    id: r.id,
    scheduleId: r.scheduleId,
    status: r.status as ReportDeliveryResponseDto['status'],
    recipients: r.recipients,
    payloadSha256: r.payloadSha256,
    payloadBytes: r.payloadBytes,
    attachmentFilename: r.attachmentFilename,
    attempts: r.attempts,
    lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    errorSnippet: r.errorSnippet,
    createdAt: r.createdAt.toISOString(),
  };
}
