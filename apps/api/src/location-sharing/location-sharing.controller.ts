import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { CreateLocationShareRequestDto } from './dto/create-location-share-request.dto';
import { LocationShareRequestResponseDto } from './dto/location-share-request-response.dto';
import {
  RespondLocationShareRequestDto,
  RespondOutcome,
} from './dto/respond-location-share-request.dto';
import { LocationSharingService, type RequestRowView } from './location-sharing.service';

/**
 * Location Sharing HTTP surface — the supervisor + user request
 * flow. The user-facing consent management (`GET/PATCH
 * /me/location-sharing`) is a separate controller
 * (`LocationSharingConsentController`) so it doesn't inherit the
 * `SUPERVISOR / HR_MANAGER / SUPER_ADMIN` role gate applied here.
 */
@ApiTags('location-sharing')
@ApiBearerAuth()
@Controller({ path: 'location-sharing', version: '1' })
export class LocationSharingController {
  constructor(private readonly service: LocationSharingService) {}

  @Post('requests')
  @Roles('SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @ApiOkResponse({ type: LocationShareRequestResponseDto })
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateLocationShareRequestDto,
  ): Promise<LocationShareRequestResponseDto> {
    const view = await this.service.createRequest(actor, {
      targetUserId: body.targetUserId,
      reason: body.reason,
    });
    return toDto(view);
  }

  @Delete('requests/:id')
  @Roles('SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LocationShareRequestResponseDto })
  async cancel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<LocationShareRequestResponseDto> {
    const view = await this.service.cancelRequest(actor, id);
    return toDto(view);
  }

  @Get('requests/:id')
  @ApiOkResponse({ type: LocationShareRequestResponseDto })
  async view(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<LocationShareRequestResponseDto> {
    // `viewRequest` handles the "fire LOCATION_SHARE_VIEWED" side
    // effect when the viewer is not the target user.
    const view = await this.service.viewRequest(actor, id);
    return toDto(view);
  }

  @Post('requests/:id/respond')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LocationShareRequestResponseDto })
  async respond(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: RespondLocationShareRequestDto,
  ): Promise<LocationShareRequestResponseDto> {
    const view = await this.service.respond(
      actor,
      id,
      body.outcome === RespondOutcome.ACCEPT
        ? {
            outcome: 'ACCEPT',
            latitude: body.latitude!,
            longitude: body.longitude!,
            accuracyMeters: body.accuracyMeters!,
            clientCapturedAt: new Date(body.clientCapturedAt!),
          }
        : { outcome: 'DECLINE' },
    );
    return toDto(view);
  }

  /**
   * Target-user inbox — live PENDING asks pointed at me.
   */
  @Get('inbox')
  @ApiOkResponse({ type: [LocationShareRequestResponseDto] })
  async myInbox(
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<LocationShareRequestResponseDto[]> {
    const rows = await this.service.listMyPending(actor);
    return rows.map(toDto);
  }

  /**
   * Supervisor's outgoing history.
   */
  @Get('outgoing')
  @Roles('SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN')
  @ApiOkResponse({ type: [LocationShareRequestResponseDto] })
  async myOutgoing(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('limit') limit?: string,
  ): Promise<LocationShareRequestResponseDto[]> {
    const parsed = limit ? Number.parseInt(limit, 10) : 25;
    const rows = await this.service.listMyOutgoing(
      actor,
      Number.isFinite(parsed) ? parsed : 25,
    );
    return rows.map(toDto);
  }
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

export function toDto(view: RequestRowView): LocationShareRequestResponseDto {
  const r = view.request;
  return {
    id: r.id,
    companyId: r.companyId,
    supervisorId: r.supervisorId,
    supervisorName: r.supervisor.fullName,
    targetUserId: r.targetUserId,
    targetUserName: r.targetUser.fullName,
    status: r.status,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
    cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
    viewedAt: r.viewedAt ? r.viewedAt.toISOString() : null,
    ping:
      view.canViewPing && r.locationPing
        ? {
            id: r.locationPing.id,
            latitude: r.locationPing.latitude.toNumber(),
            longitude: r.locationPing.longitude.toNumber(),
            accuracyMeters: r.locationPing.accuracyMeters,
            clientCapturedAt: r.locationPing.clientCapturedAt.toISOString(),
            createdAt: r.locationPing.createdAt.toISOString(),
          }
        : null,
  };
}
