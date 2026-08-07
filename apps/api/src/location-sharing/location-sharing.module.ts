import { Module } from '@nestjs/common';

import { LocationSharingConsentController } from './location-sharing-consent.controller';
import { LocationSharingRetentionWorker } from './location-sharing-retention.worker';
import { LocationSharingController } from './location-sharing.controller';
import { LocationSharingService } from './location-sharing.service';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityPolicyModule } from '../security-policy/security-policy.module';

/**
 * ADR-0041 — Location Sharing During Active Shift.
 *
 * Exports the service so `TestSupportModule` can kick the retention
 * worker in E2E; the worker itself is imported here so the cron
 * registers on API startup. Feature is safe to import even when
 * `SecurityPolicy.locationSharingEnabled = false` — every mutation
 * gates on the tenant flag internally.
 */
@Module({
  imports: [PrismaModule, NotificationModule, SecurityPolicyModule],
  controllers: [LocationSharingController, LocationSharingConsentController],
  providers: [LocationSharingService, LocationSharingRetentionWorker],
  exports: [LocationSharingService, LocationSharingRetentionWorker],
})
export class LocationSharingModule {}
