import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { WebhookEventType } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import {
  CreateWebhookDto,
  UpdateWebhookDto,
  WebhookDeliveryListDto,
  WebhookEndpointListDto,
  WebhookEndpointRowDto,
  WebhookEndpointWithSecretDto,
} from './dto/webhook.dto';
import { WebhookDispatcher } from './webhook-dispatcher.service';
import { WebhookService } from './webhook.service';

/**
 * Fase 32e — admin surface for webhook subscriptions. Only HR /
 * Super Admin of the tenant may reach any of these endpoints.
 *
 * Delivery-log endpoint is scoped by companyId at the service layer;
 * `?endpointId=` narrows further so operators can debug one vendor
 * at a time.
 */
@ApiTags('Webhooks')
@Controller({ path: 'admin/webhooks', version: '1' })
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class WebhookController {
  constructor(
    private readonly service: WebhookService,
    private readonly dispatcher: WebhookDispatcher,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @ApiOkResponse({ type: WebhookEndpointListDto })
  async list(@CurrentUser() actor: AuthenticatedUser): Promise<WebhookEndpointListDto> {
    const items = await this.service.list(actor);
    return { items };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiCreatedResponse({ type: WebhookEndpointWithSecretDto })
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateWebhookDto,
  ): Promise<WebhookEndpointWithSecretDto> {
    return this.service.create(actor, {
      url: body.url,
      description: body.description ?? null,
      events: body.events,
    });
  }

  @Patch(':id')
  @ApiBearerAuth()
  @ApiOkResponse({ type: WebhookEndpointRowDto })
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateWebhookDto,
  ): Promise<WebhookEndpointRowDto> {
    return this.service.update(actor, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiNoContentResponse()
  async remove(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.service.remove(actor, id);
  }

  @Post(':id/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOkResponse({ type: WebhookEndpointWithSecretDto })
  async rotateSecret(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<WebhookEndpointWithSecretDto> {
    return this.service.rotateSecret(actor, id);
  }

  /**
   * Fire a synthetic `TIMESHEET_EXPORT_CREATED` event so HR can
   * confirm the vendor endpoint is wired before real payroll data
   * flows through. Uses a fake sourceId so it doesn't collide with a
   * real export's unique key.
   */
  @Post(':id/test-fire')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth()
  async testFire(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ enqueued: true }> {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id, companyId: actor.companyId, active: true },
      select: { events: true },
    });
    if (!endpoint) throw new NotFoundException('WEBHOOK_NOT_FOUND');
    const event: WebhookEventType = endpoint.events[0] ?? 'TIMESHEET_EXPORT_CREATED';
    await this.dispatcher.enqueue({
      companyId: actor.companyId,
      eventType: event,
      sourceId: `test_${id}_${Date.now()}`,
      data: {
        test: true,
        firedBy: actor.email,
      },
    });
    return { enqueued: true };
  }

  @Get('deliveries')
  @ApiBearerAuth()
  @ApiOkResponse({ type: WebhookDeliveryListDto })
  async listDeliveries(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('endpointId') endpointId?: string,
    @Query('limit') limit?: string,
  ): Promise<WebhookDeliveryListDto> {
    const take = Math.max(1, Math.min(200, Number(limit ?? '50')));
    const rows = await this.prisma.webhookDelivery.findMany({
      where: {
        companyId: actor.companyId,
        ...(endpointId ? { endpointId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        endpointId: r.endpointId,
        eventType: r.eventType,
        sourceId: r.sourceId,
        status: r.status,
        attemptCount: r.attemptCount,
        nextAttemptAt: r.nextAttemptAt.toISOString(),
        lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
        lastResponseStatus: r.lastResponseStatus,
        lastError: r.lastError,
        deliveredAt: r.deliveredAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
