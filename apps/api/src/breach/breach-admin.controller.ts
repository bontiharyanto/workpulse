import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { toDetailDto, toListItemDto } from './breach.mapper';
import { BreachService } from './breach.service';
import {
  AppendBreachNoteDto,
  BreachIncidentListItemDto,
  BreachIncidentResponseDto,
  CloseBreachDto,
  CreateBreachIncidentDto,
  NotifyAuthorityDto,
  NotifySubjectsDto,
  UpdateBreachIncidentDto,
} from './dto/breach.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

/**
 * Fase 31g — Breach Notification Ledger admin controller.
 *
 * RBAC: `HR_MANAGER` and `SUPER_ADMIN` only — breach incidents surface
 * PII exposure counts and vendor names that must not leak beyond DPO
 * scope. Employees + supervisors get 403.
 *
 * Throttling is tight on lifecycle mutations because each one triggers
 * downstream side-effects (regulator paperwork, notifications).
 */
@ApiTags('admin · security · breach')
@Controller('admin/security/breaches')
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class BreachAdminController {
  constructor(private readonly service: BreachService) {}

  @Get()
  async list(@CurrentUser() actor: AuthenticatedUser): Promise<BreachIncidentListItemDto[]> {
    const rows = await this.service.list(actor);
    return rows.map((r) => toListItemDto(r));
  }

  @Get(':id')
  async detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<BreachIncidentResponseDto> {
    return toDetailDto(await this.service.detail(actor, id));
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateBreachIncidentDto,
  ): Promise<BreachIncidentResponseDto> {
    return toDetailDto(await this.service.create(actor, body));
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Patch(':id')
  async patch(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateBreachIncidentDto,
  ): Promise<BreachIncidentResponseDto> {
    return toDetailDto(await this.service.update(actor, id, body));
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post(':id/mark-contained')
  @HttpCode(HttpStatus.OK)
  async markContained(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: AppendBreachNoteDto,
  ): Promise<BreachIncidentResponseDto> {
    return toDetailDto(await this.service.markContained(actor, id, body.note));
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post(':id/notify-authority')
  @HttpCode(HttpStatus.OK)
  async notifyAuthority(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: NotifyAuthorityDto,
  ): Promise<BreachIncidentResponseDto> {
    return toDetailDto(
      await this.service.notifyAuthority(actor, id, {
        notifiedAt: body.notifiedAt,
        authorityRef: body.authorityRef,
        note: body.note,
      }),
    );
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post(':id/notify-subjects')
  @HttpCode(HttpStatus.OK)
  async notifySubjects(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: NotifySubjectsDto,
  ): Promise<BreachIncidentResponseDto> {
    return toDetailDto(
      await this.service.notifySubjects(actor, id, {
        notifiedAt: body.notifiedAt,
        template: body.template,
        note: body.note,
      }),
    );
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  async close(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: CloseBreachDto,
  ): Promise<BreachIncidentResponseDto> {
    return toDetailDto(await this.service.close(actor, id, body));
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post(':id/notes')
  @HttpCode(HttpStatus.CREATED)
  async addNote(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: AppendBreachNoteDto,
  ): Promise<BreachIncidentResponseDto> {
    return toDetailDto(await this.service.appendNote(actor, id, body.note));
  }
}
