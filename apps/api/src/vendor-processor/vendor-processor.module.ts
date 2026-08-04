import { Module } from '@nestjs/common';


import { VendorProcessorController } from './vendor-processor.controller';
import { VendorProcessorService } from './vendor-processor.service';
import { VendorReviewReminderWorker } from './vendor-review-reminder.worker';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Fase 31f — Vendor / Processor Register module.
 *
 * Endpoints (all HR_MANAGER + SUPER_ADMIN):
 *   - `GET    /admin/privacy/vendors`                  — list
 *   - `GET    /admin/privacy/vendors/:id`              — detail
 *   - `POST   /admin/privacy/vendors`                  — create
 *   - `PATCH  /admin/privacy/vendors/:id`              — update / status
 *   - `POST   /admin/privacy/vendors/:id/mark-reviewed`
 *   - `POST   /admin/privacy/vendors/:id/terminate`
 *   - `POST   /admin/privacy/vendors/:id/ropa-links`
 *   - `DELETE /admin/privacy/vendors/:id/ropa-links/:linkId`
 *
 * Also exposes `VendorReviewReminderWorker` (daily 07:00 UTC).
 */
@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [VendorProcessorController],
  providers: [VendorProcessorService, VendorReviewReminderWorker],
  exports: [VendorProcessorService],
})
export class VendorProcessorModule {}
