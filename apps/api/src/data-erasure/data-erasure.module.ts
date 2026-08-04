import { Module } from '@nestjs/common';

import { DataErasureAdminController } from './data-erasure-admin.controller';
import { DataErasureController } from './data-erasure.controller';
import { DataErasureService } from './data-erasure.service';
import { DataErasureWorker } from './data-erasure.worker';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

/**
 * Wires the right-to-erasure surface (Fase 31b): self-service +
 * admin controllers, service + worker. The worker registers its
 * `@Cron` at bootstrap because `ScheduleModule.forRoot()` is
 * imported at the app root.
 */
@Module({
  imports: [PrismaModule, StorageModule, NotificationModule],
  controllers: [DataErasureController, DataErasureAdminController],
  providers: [DataErasureService, DataErasureWorker],
  // `DataErasureWorker` is re-exported so `TestSupportModule` can
  // dep-inject it and kick a tick on demand during E2E runs.
  exports: [DataErasureService, DataErasureWorker],
})
export class DataErasureModule {}
