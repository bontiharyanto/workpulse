import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  ConsentAction,
  LocationSharingSelfStatusDto,
  UpdateLocationSharingConsentDto,
} from './dto/consent.dto';
import { LocationSharingService } from './location-sharing.service';

/**
 * User-facing consent surface. Deliberately mounted under
 * `/me/location-sharing` (not under `/location-sharing`) so it
 * inherits the "authenticated user only" pattern of the rest of
 * `/me/*` and does NOT pick up the SUPERVISOR-role gate on the
 * supervisor controller.
 */
@ApiTags('location-sharing')
@ApiBearerAuth()
@Controller({ path: 'me/location-sharing', version: '1' })
export class LocationSharingConsentController {
  constructor(private readonly service: LocationSharingService) {}

  @Get()
  @ApiOkResponse({ type: LocationSharingSelfStatusDto })
  async selfStatus(
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<LocationSharingSelfStatusDto> {
    const status = await this.service.getSelfStatus(actor);
    return {
      tenantEnabled: status.tenantEnabled,
      eligible: status.eligible,
      consentedAt: status.consentedAt ? status.consentedAt.toISOString() : null,
      consentedCopySha: status.consentedCopySha,
      currentCopySha: status.currentCopySha,
    };
  }

  @Patch('consent')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateConsent(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: UpdateLocationSharingConsentDto,
  ): Promise<void> {
    await this.service.updateConsent(
      actor,
      body.action === ConsentAction.OPT_IN
        ? { action: 'OPT_IN', consentCopySha: body.consentCopySha! }
        : { action: 'OPT_OUT' },
    );
  }
}
