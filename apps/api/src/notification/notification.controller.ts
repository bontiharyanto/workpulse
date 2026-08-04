import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type {
  Notification as SharedNotification,
  NotificationPage,
  UnreadCountResponse,
} from '@workpulse/shared-types';


import {
  NotificationArchivePageDto,
  NotificationArchiveQueryDto,
} from './dto/notification-archive.dto';
import {
  NotificationPreferenceRowDto,
  UpdateNotificationPreferencesDto,
} from './dto/notification-preference.dto';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationService } from './notification.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

/**
 * All endpoints operate on the *caller's* notifications only. There is no
 * "list a peer's notifications" API by design — that would leak audit
 * information. Admin observability of the notification stream is a
 * separate concern handled via AuditLog.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller({ path: 'notifications', version: '1' })
@Roles('EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN')
export class NotificationController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly preferences: NotificationPreferenceService,
  ) {}

  /**
   * Bell-dropdown feed. `limit` is bounded by the service (1..100); the
   * frontend requests 20 by default. Polling every 30s + this bounded
   * result set keeps memory and bandwidth tiny for busy tenants.
   */
  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOkResponse({ description: 'Recent notifications for the caller (newest first)' })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('limit') limit?: string,
  ): Promise<SharedNotification[]> {
    return this.notifications.list(actor, {
      unreadOnly: unreadOnly === 'true' || unreadOnly === '1',
      limit: limit ? Number(limit) : undefined,
    });
  }

  /**
   * Cheap counter for the badge. Polled aggressively by the frontend
   * (every 30s), so it needs to stay fast; the composite index
   * (recipientId, readAt, createdAt) covers this query.
   */
  @Get('unread-count')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOkResponse({ description: 'Number of unread notifications for the caller' })
  async unreadCount(@CurrentUser() actor: AuthenticatedUser): Promise<UnreadCountResponse> {
    const unreadCount = await this.notifications.unreadCount(actor);
    return { unreadCount };
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    if (!id || id.length < 3) {
      // Defence in depth against callers passing empty / obviously bogus IDs
      // even though the router already requires the segment to be non-empty.
      throw new NotFoundException('NOTIFICATION_NOT_FOUND');
    }
    await this.notifications.markRead(actor, id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Marks all unread notifications as read' })
  async markAllRead(@CurrentUser() actor: AuthenticatedUser): Promise<{ marked: number }> {
    return this.notifications.markAllRead(actor);
  }

  /**
   * Paginated archive view for the `/notifications` page (Fase 25).
   *
   * Distinct from `GET /notifications` because it returns a
   * `{ rows, nextCursor }` envelope instead of a flat array — the
   * bell dropdown doesn't need the envelope and shouldn't pay the
   * cost of parsing it. Two callers, two shapes.
   *
   * Rate limit matches the bell list endpoint (60 req/min); the
   * archive isn't polled aggressively — user scrolls, not
   * background refresh.
   */
  @Get('archive')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOkResponse({ type: NotificationArchivePageDto })
  archive(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: NotificationArchiveQueryDto,
  ): Promise<NotificationPage> {
    return this.notifications.listPaginated(actor, {
      unreadOnly: query.unreadOnly ?? false,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  // -----------------------------------------------------------------
  // Preferences (Fase 22)
  // -----------------------------------------------------------------

  /**
   * Return one row per known NotificationType, hydrated with the
   * caller's stored preferences (or defaults-on when nothing is
   * stored). Mandatory types come back with `mandatory=true` and both
   * flags forced-on — the FE renders them locked.
   */
  @Get('preferences')
  @ApiOkResponse({ type: [NotificationPreferenceRowDto] })
  listPreferences(
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<NotificationPreferenceRowDto[]> {
    return this.preferences.listForActor(actor);
  }

  /**
   * Bulk-upsert overrides for a batch of `NotificationType`s.
   *
   * Idempotency: sending the same payload twice is a no-op relative to
   * the second call — the row was already at that value. The response
   * always returns the full effective list (identical shape to
   * `GET /preferences`), so the FE can trust it as the new state
   * without a follow-up refetch.
   */
  @Put('preferences')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: [NotificationPreferenceRowDto] })
  updatePreferences(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferenceRowDto[]> {
    return this.preferences.upsertMany(actor, dto.updates);
  }
}
